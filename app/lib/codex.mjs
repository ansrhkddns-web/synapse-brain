// 코덱스 작업 기록 (비서실): 이 PC의 Codex 세션(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)을 작업 파일로 남긴다.
//   코덱스에는 Claude 훅이 없어서 30초마다 바뀐 기록 파일만 다시 읽는다.
//   - 사람이 연 세션(Codex 데스크톱·CLI 대화) = 작업 하나 (tags: 바깥세션 · 코덱스 · cx-<세션 id>).
//     새 사람 말 → 실행중 + 진행 로그 "사람: …", 턴 끝(task_complete) → 검수 + 결과에 마지막 답. Claude 바깥 세션 기록과 같은 모양.
//   - 다른 프로그램이 부른 일회성 호출(codex exec — Claude 스킬의 이미지 생성·교차 검토 등)은 수백 개라 하나씩 만들지 않는다.
//     날짜 × 작업 폴더마다 작업 하나로 묶어(tags: 코덱스 · 코덱스호출 · cxg-<날짜>-<폴더 열쇠>) 호출 수·시각·지시 첫 줄을 쌓는다. 상태는 완료.
//   배정은 Claude 작업 기록과 같다: 연 폴더 → 만진 경로 → 말의 낱말. 못 가리면 비정규직.
//   어디까지 읽었는지는 app/codex-state.json (파일별 mtime·크기·이미 적은 사람 말 수).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { place, byText, makeRules } from './activity.mjs';
import { TAG, AUTO_NAME } from './worklog.mjs';

export const CODEX_TAG = '코덱스';
export const CALL_TAG = '코덱스호출';
export const CODEX_HOME = path.join(os.homedir(), '.codex');
const AUTO = '자동배정';
const FALLBACK = '비정규직';
const RECENT_MS = 24 * 3600_000;
const WIN_PATH = /[A-Za-z]:[\\/][^"'`\n\r|<>*?;]+/g;

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const redact = (s) => String(s ?? '').replace(/[A-Za-z0-9_\-+/=]{24,}/g, '(가림)');
const human = (s) => String(s ?? '')
  .replace(/<([a-z_-]+)[^>]*>[\s\S]*?<\/\1>/g, '')
  .replace(/<\/?image[^>]*>/g, '')
  .trim();
const kstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
const kstTime = (iso) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(11, 16);
// 코덱스가 사람 말 자리에 붙이는 지침·환경·참조 대화는 사람 말이 아니다
const INJECTED = /^(# AGENTS\.md instructions|<environment_context>|<user_instructions>|## Referenced ChatGPT conversation|<permissions instructions>)/;

export const cxTag = (id) => `cx-${id}`;
export const isCodex = (t) => Array.isArray(t?.tags) && t.tags.includes(CODEX_TAG);

// ── 기록 파일 하나 읽기 ──
export function parseRollout(text) {
  const out = { id: null, cwd: null, originator: null, start: null, end: null, prompts: [], last: null, ended: true, paths: [], calls: 0 };
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const p = j.payload ?? {};
    if (j.timestamp) { out.start ??= j.timestamp; out.end = j.timestamp; }
    if (j.type === 'session_meta') {
      out.id = p.id ?? p.session_id ?? out.id;
      out.cwd = p.cwd ?? out.cwd;
      out.originator = p.originator ?? null;
      continue;
    }
    if (j.type === 'turn_context' && p.cwd) out.cwd = p.cwd;
    if (j.type === 'event_msg') {
      if (p.type === 'task_started') out.ended = false;
      else if (p.type === 'task_complete') { out.ended = true; if (p.last_agent_message) out.last = p.last_agent_message; }
      continue;
    }
    if (j.type !== 'response_item') continue;
    if (p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
      const raw = p.content.filter((b) => b.type === 'input_text').map((b) => b.text).join('\n');
      if (INJECTED.test(raw.trimStart())) continue;
      const h = human(raw);
      if (h) { out.prompts.push({ at: j.timestamp ?? out.end, text: h }); out.ended = false; }
    } else if (p.type === 'message' && p.role === 'assistant' && Array.isArray(p.content)) {
      const t = p.content.filter((b) => b.type === 'output_text').map((b) => b.text).join('\n').trim();
      if (t) out.last = t;
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      out.calls++;
      const s = String(p.arguments ?? p.input ?? JSON.stringify(p.action ?? {})).replace(/\\\\/g, '\\');
      for (const m of s.matchAll(WIN_PATH)) out.paths.push(m[0]);
    }
  }
  out.paths = out.paths.slice(-60);
  return out;
}

// 기록 첫머리 4KB에서 originator만 (session_meta는 첫 줄)
export function headOriginator(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(4096); const n = fs.readSync(fd, buf, 0, 4096, 0); return buf.toString('utf8', 0, n).match(/"originator":"([^"]+)"/)?.[1] ?? null; }
    finally { fs.closeSync(fd); }
  } catch { return null; }
}

// 일회성 호출(codex exec)인가 — 사람이 대화로 연 세션이 아니다
export const isExecCall = (s) => /exec/i.test(s.originator ?? '');

// 스레드 이름 (Codex 데스크톱이 붙인 이름, 같은 id는 마지막 것)
export function readThreadNames(home = CODEX_HOME) {
  const names = new Map();
  let text = '';
  try { text = fs.readFileSync(path.join(home, 'session_index.jsonl'), 'utf8'); } catch { return names; }
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try { const j = JSON.parse(line); if (j.id && j.thread_name) names.set(j.id, String(j.thread_name).slice(0, 60)); } catch { /* 깨진 줄 */ }
  }
  return names;
}

// 기록 파일 목록 (sessions 아래 전부 + archived_sessions)
export function listRollouts(home = CODEX_HOME) {
  const out = [];
  const walk = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(path.join(home, 'sessions'), 0);
  walk(path.join(home, 'archived_sessions'), 0);
  return out;
}

export function createCodexLog({ store, home = CODEX_HOME, stateFile, now = () => Date.now(), perTick = 60 }) {
  let state = { files: {} };
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); state.files ??= {}; } catch { /* 처음 */ }
  const save = () => { if (stateFile) try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch { /* 다음에 */ } };
  let busy = false;

  const route = (cwd, paths, text) => {
    const rules = makeRules({ depts: store.depts(), units: store.units(), processes: store.processes() });
    // Codex 데스크톱은 Documents\Codex\<날짜>\<주제> 같은 빈 폴더에서 열린다 → 폴더가 일을 말해 주지 않으면 말의 낱말로
    let w = place(rules, cwd, paths);
    if (!w.dept) w = byText(rules, text);
    return w.dept ? { dept: w.dept, unit: w.unit ?? null } : { dept: FALLBACK, unit: null };
  };

  const index = () => {
    const bySession = new Map(), byGroup = new Map();
    for (const t of store.listTasks()) {
      for (const x of t.tags ?? []) {
        if (String(x).startsWith('cx-')) bySession.set(String(x).slice(3), t.id);
        if (String(x).startsWith('cxg-')) byGroup.set(String(x), t.id);
      }
    }
    return { bySession, byGroup };
  };

  // 사람이 연 세션 하나
  async function session(s, file, seen, idx, names) {
    let id = idx.bySession.get(s.id) ?? null;
    if (id) { try { store.readTask(id); } catch { id = null; } }
    const fresh = s.prompts.slice(seen ?? 0);
    const title = names.get(s.id) ?? clip(redact(s.prompts[0]?.text), 60);
    if (!id) {
      if (!s.prompts.length) return seen ?? 0;
      const where = route(s.cwd, s.paths, `${title} ${s.prompts.map((p) => p.text).join(' ')}`);
      const recent = now() - Date.parse(s.end ?? 0) < RECENT_MS;
      id = await store.createTask({
        ...where, status: '실행중', title,
        instruction: `${redact(s.prompts[0].text).slice(0, 2000)}\n\n> Codex 세션 \`${s.id}\` · 작업 폴더 \`${s.cwd ?? '?'}\` — 비서실 코덱스 기록이 자동으로 만든 기록이다.`,
        tags: [TAG, CODEX_TAG, AUTO, AUTO_NAME, cxTag(s.id)],
      });
      idx.bySession.set(s.id, id);
      await store.appendLog(id, `코덱스 세션 · 배정 → ${where.dept}${where.unit ? ` / ${where.unit}` : ''}`);
      for (const p of s.prompts.slice(1)) await store.appendLog(id, `사람: ${clip(redact(p.text), 140)} (${kstTime(p.at)})`);
      if (s.ended) {
        await store.setResult(id, `${clip(redact(s.last), 700) || '(마지막 답 없음)'}\n\n> 코덱스 턴이 끝난 때의 마지막 답.`, recent ? '검수' : '완료');
        if (!recent) await store.appendLog(id, '지난 기록 채움 — 완료로 둠');
      }
      return s.prompts.length;
    }
    // 상태 파일 없이 기록만 있으면(상태를 잃음) 지금까지 말은 이미 적힌 것으로 본다 — 같은 줄을 두 번 쓰지 않게
    if (seen == null) return s.prompts.length;
    const t = store.readTask(id).data;
    if (t.tags?.includes(AUTO_NAME) && names.get(s.id) && names.get(s.id) !== t.title) await store.renameTask(id, names.get(s.id), '코덱스 스레드 이름으로');
    if (fresh.length) {
      if (t.status !== '실행중') await store.patchTask(id, { status: '실행중' });
      for (const p of fresh) await store.appendLog(id, `사람: ${clip(redact(p.text), 140)}${['완료', '취소'].includes(t.status) ? ` (${t.status}에서 다시 엶)` : ''}`);
    }
    const now2 = store.readTask(id).data.status;
    if (s.ended && now2 === '실행중') {
      await store.setResult(id, `${clip(redact(s.last), 700) || '(마지막 답 없음)'}\n\n> 코덱스 턴이 끝난 때의 마지막 답. 이어서 일하면 다시 실행중이 된다.`, '검수');
      await store.appendLog(id, '코덱스 턴 끝');
    }
    return s.prompts.length;
  }

  // 일회성 호출: 날짜 × 폴더로 묶는다
  async function call(s, file, seen, idx) {
    if (seen > 0 || !s.start) return Math.max(seen, 1);
    const day = kstDay(s.start);
    const cwd = s.cwd ?? '?';
    const key = `cxg-${day.replace(/-/g, '').slice(2)}-${crypto.createHash('sha1').update(cwd.toLowerCase()).digest('hex').slice(0, 8)}`;
    const ask = clip(redact(s.prompts[0]?.text ?? '(지시 없음)'), 100);
    let id = idx.byGroup.get(key) ?? null;
    if (id) { try { store.readTask(id); } catch { id = null; } }
    if (!id) {
      const where = route(s.cwd, s.paths, ask);
      id = await store.createTask({
        ...where, status: '완료',
        title: clip(`코덱스 호출 · ${path.basename(cwd) || cwd} · ${day.slice(5)}`, 60),
        instruction: `다른 세션·스크립트가 부른 Codex 일회성 호출(codex exec)을 날짜·작업 폴더로 묶은 기록이다.\n\n> 작업 폴더 \`${cwd}\` · ${day}`,
        tags: [CODEX_TAG, CALL_TAG, AUTO, key],
      });
      idx.byGroup.set(key, id);
      await store.appendLog(id, `배정 → ${where.dept}${where.unit ? ` / ${where.unit}` : ''}`);
    }
    const mark = `#${s.id.slice(-8)}`;
    if (!store.readTask(id).body.includes(mark)) await store.appendLog(id, `호출 ${kstTime(s.start)} · ${ask}${s.ended ? '' : ' (끝 안 남)'} ${mark}`);
    return 1;
  }

  // 바뀐 기록만 읽어 보관함에 반영한다. → { sessions, calls }
  async function tick() {
    if (busy) return { skipped: true };
    busy = true;
    const done = { sessions: 0, calls: 0, more: false };
    try {
      const idx = index();
      const names = readThreadNames(home);
      // 오래된 것부터 (묶음 기록의 줄 순서가 시간 순이 되게)
      const files = listRollouts(home).map((f) => { try { const st = fs.statSync(f); return { f, mtime: st.mtimeMs, size: st.size }; } catch { return null; } })
        .filter(Boolean).sort((a, b) => a.mtime - b.mtime);
      let work = 0;
      for (const { f, mtime, size } of files) {
        const key = path.basename(f);
        const prev = state.files[key];
        if (prev && prev.mtime === mtime && prev.size === size) continue;
        // 서버가 멈추지 않게: 한 번에 PER_TICK개까지만, 파일마다 쉬어 가며 (나머지는 다음 차례에)
        if (work++ >= perTick) { done.more = true; break; }
        await new Promise((r) => setImmediate(r));
        let s;
        try { s = parseRollout(await fs.promises.readFile(f, 'utf8')); } catch { continue; }
        if (!s.id) { state.files[key] = { mtime, size, seen: 0 }; continue; }
        const seen = prev?.seen ?? 0;
        try {
          const n = isExecCall(s) ? await call(s, f, seen, idx) : await session(s, f, prev ? seen : null, idx, names);
          if (isExecCall(s)) { if (!seen) done.calls++; } else if (n > seen || !prev) done.sessions++;
          state.files[key] = { mtime, size, seen: n };
          if (work % 20 === 0) save();
        } catch { /* 이 파일은 다음에 다시 */ }
      }
      save();
    } finally { busy = false; }
    return done;
  }

  // 지금 도는 사람 세션 (지도·데스크용): 기록 안의 마지막 시각이 최근 30분 안인 것.
  //   코덱스가 열어 둔 기록 파일은 윈도우에서 수정 시각이 만든 때에 머문다(크기만 바뀐다) → 크기로 바뀐 걸 알고, 시각은 기록 안의 것으로
  const liveCache = new Map();
  function live(activeMs = 30 * 60_000, keepMs = 3 * 86400_000) {
    const out = [];
    const names = readThreadNames(home);
    for (const f of listRollouts(home)) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      let c = liveCache.get(f);
      if (!c && now() - st.mtimeMs > keepMs) continue;   // 사흘 넘게 안 열린 옛 기록은 읽지 않는다
      if (c?.exec) continue;
      if (!c || c.size !== st.size) {
        // 일회성 호출은 첫머리(session_meta의 originator)만 보고 건너뛴다 — 수백 개를 통째로 읽지 않게
        if (!c && isExecCall({ originator: headOriginator(f) })) { liveCache.set(f, { exec: true }); continue; }
        try { c = { size: st.size, s: parseRollout(fs.readFileSync(f, 'utf8')) }; } catch { continue; }
        liveCache.set(f, c);
      }
      const s = c.s;
      if (!s.id || isExecCall(s)) continue;
      const at = Math.max(st.mtimeMs, Date.parse(s.end ?? 0) || 0);
      if (now() - at > activeMs) continue;
      out.push({ ...s, title: names.get(s.id) ?? clip(s.prompts.at(-1)?.text, 40), mtime: at });
    }
    return out;
  }

  return { tick, live, busy: () => busy };
}
