// Claude 사용량 (ccusage 방식): 이 PC의 Claude Code 대화 기록(~/.claude/projects/*/*.jsonl)에서 assistant 응답의 usage를 모은다.
//   오늘(자정부터) · 최근 5시간 창 · 세션별 · 모델별. 같은 응답이 블록마다 여러 줄로 남으므로 message.id(+requestId)로 한 번만 센다.
//   두뇌 세션도 SDK가 같은 곳에 기록을 남기므로 함께 잡힌다. 돈 대신 토큰으로 보인다(구독이면 금액이 의미 없다).
// 파일은 커진 만큼만 이어 읽는다 (처음엔 오늘 바뀐 파일만 끝까지). 보는 사람이 있을 때만 계산.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE_MS = 30_000;
const WINDOW_MS = 5 * 3600_000;
const CHUNK = 4 * 1024 * 1024;
const KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'];

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0 });
const add = (a, u) => { for (const k of KEYS) a[k] += u[k]; a.total += u.input + u.output + u.cacheRead + u.cacheWrite; a.calls += 1; return a; };

// 기록 한 줄 → 사용량 하나 (아니면 null)
export function usageOf(line) {
  if (!line.includes('"usage"')) return null;
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  const m = j.message;
  const u = m?.usage;
  if (j.type !== 'assistant' || !u || !m.id) return null;
  const t = Date.parse(j.timestamp);
  if (!Number.isFinite(t)) return null;
  return {
    key: `${m.id}:${j.requestId ?? ''}`, t, session: j.sessionId ?? null, model: m.model ?? '?',
    input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

export function createTokens({ projectsDir = path.join(os.homedir(), '.claude', 'projects'), now = () => Date.now() } = {}) {
  const files = new Map();   // 파일 → { offset, rest }
  const seen = new Map();    // 응답 key → 사용량 (하루치만 들고 있는다)
  const names = new Map();   // 세션 id → 제목
  let cache = null;

  function readFrom(file, st) {
    let f = files.get(file);
    if (!f || st.size < f.offset) f = { offset: 0, rest: '' };
    if (st.size === f.offset) { files.set(file, f); return; }
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(CHUNK, st.size - f.offset));
      while (f.offset < st.size) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, st.size - f.offset), f.offset);
        if (n <= 0) break;
        f.offset += n;
        const text = f.rest + buf.toString('utf8', 0, n);
        const lines = text.split('\n');
        f.rest = lines.pop();
        // 조각 경계에서 한글이 잘려도 줄 단위로만 쓰므로, 덜 끝난 줄은 다음 조각과 합친다
        if (f.rest.length > 8 * 1024 * 1024) f.rest = '';   // 비정상적으로 긴 줄(이미지 등)은 버린다
        for (const line of lines) {
          // 세션 이름 (사이드바 제목) — 지금 안 보이는 세션도 이름으로 보이게
          if (line.includes('"custom-title"')) { try { const j = JSON.parse(line); if (j.customTitle && j.sessionId) names.set(j.sessionId, j.customTitle); } catch { /* 깨진 줄 */ } }
          const u = usageOf(line);
          if (u && !seen.has(u.key)) seen.set(u.key, u);
        }
      }
    } finally { fs.closeSync(fd); }
    files.set(file, f);
  }

  function scan(t) {
    const day = Math.min(startOfDay(t), t - WINDOW_MS);
    let dirs = [];
    try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return; }
    for (const d of dirs) {
      const dir = path.join(projectsDir, d.name);
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
      for (const n of names) {
        const file = path.join(dir, n);
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        if (st.mtimeMs < day) continue;
        try { readFrom(file, st); } catch { /* 읽다 실패한 파일은 다음에 */ }
      }
    }
    for (const [k, u] of seen) if (u.t < day) seen.delete(k);
  }

  function snapshot({ titles = new Map() } = {}) {
    const t = now();
    if (cache && t - cache.at < CACHE_MS) return cache;
    scan(t);
    const day = startOfDay(t);
    const today = zero(), win = zero();
    const bySession = new Map(), byModel = new Map();
    let winStart = null;
    for (const u of seen.values()) {
      if (u.t >= day) {
        add(today, u);
        add(bySession.get(u.session) ?? bySession.set(u.session, { id: u.session, ...zero() }).get(u.session), u);
        add(byModel.get(u.model) ?? byModel.set(u.model, { model: u.model, ...zero() }).get(u.model), u);
      }
      if (u.t >= t - WINDOW_MS) { add(win, u); winStart = winStart == null ? u.t : Math.min(winStart, u.t); }
    }
    cache = {
      at: t, today, window: { ...win, since: winStart ? new Date(winStart).toISOString() : null, hours: 5 },
      sessions: [...bySession.values()].sort((a, b) => b.total - a.total).slice(0, 30).map((s) => ({ ...s, title: titles.get(s.id) ?? names.get(s.id) ?? null })),
      models: [...byModel.values()].sort((a, b) => b.total - a.total),
    };
    return cache;
  }

  return { snapshot };
}
