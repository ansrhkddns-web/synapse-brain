// PC에서 도는 AI 일 추적 (자원관리부): 두뇌가 띄우지 않은 일도 지도에 올린다.
//   세션 = Claude Code 대화 기록(~/.claude/projects/*/*.jsonl — 데스크톱 앱·터미널 모두). 제목·작업 폴더·지금 하는 일·만지는 경로.
//   프로그램 = 사용량 측정기 표본의 명령줄(ollama·python·ffmpeg·node…). 어느 세션 아래에서 돌았는지는 프로세스 부모를 따라간다.
// 둘 다 만지는 경로를 부서·하위 항목·공정의 workdir·match와 맞춰 어디 일인지 가려 내고, 이름이 나온 작업(W-…)과 잇는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ACTIVE_MS = 30 * 60_000;   // 이 안에 기록이 바뀐 세션만 보인다
export const WORKING_MS = 3 * 60_000;   // 턴이 안 끝났고 이 안에 움직였으면 "작업 중"
const TAIL = 2 * 1024 * 1024;
const CACHE_MS = 4_000;
const TASK_ID = /\bW-\d{6}-\d{3}\b/g;
const WIN_PATH = /[A-Za-z]:[\\/][^"'`\n\r|<>*?;]+/g;
const SESSION_ARG = /--(?:resume|session-id)[= ]"?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const PROGRAM = /^(python|pythonw|ffmpeg|ffprobe|ollama|llama-server|whisper[^.]*|comfy[^.]*|node)\.exe$/i;
const INTERNAL = /Claude-Data|OpenAI\\Codex|codex-runtimes|brain-demo|\\npm-cache\\|vite(\.js)?\b|\\usage\.ps1/i;

const norm = (s) => String(s).replace(/\//g, '\\').replace(/[\\\s.,)]+$/, '').toLowerCase();
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ── 대화 기록 끝부분 읽기 ──
// 사람 말: 문자열이거나 text 블록이 있고 tool_result가 없는 user 기록 (시스템이 붙인 <…> 덩어리는 뺀다)
function promptText(j) {
  if (j.type !== 'user' || j.isMeta || j.isSidechain) return null;
  const c = j.message?.content;
  const raw = typeof c === 'string' ? c
    : Array.isArray(c) && !c.some((b) => b.type === 'tool_result') ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : null;
  if (!raw) return null;
  const t = raw.replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/g, '').trim();
  return t || null;
}

function toolArg(input = {}) {
  if (input.file_path) return path.basename(String(input.file_path));
  if (input.description) return clip(input.description, 70);
  if (input.command) return clip(input.command, 70);
  if (input.pattern) return clip(input.pattern, 50);
  if (input.url) return clip(input.url, 60);
  if (input.recap) return clip(input.recap, 70);
  return '';
}

export function parseTranscript(text) {
  const out = { title: null, cwd: null, prompt: null, lastAt: null, ended: true, tool: null, text: null, paths: [], taskRefs: [] };
  const refs = new Set();
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    // 스크린샷·긴 출력이 든 도구 결과 줄은 읽지 않는다 (경로·말은 assistant 쪽에 있다) — "도구 결과 = 아직 도는 중"만 남긴다
    if (line.length > 50_000 && line.includes('"tool_result"')) { out.ended = false; continue; }
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.cwd) out.cwd = j.cwd;
    if (j.type === 'custom-title' && j.customTitle) out.title = j.customTitle;
    else if (j.type === 'agent-name' && j.agentName && !out.title) out.title = j.agentName;
    else if (j.type === 'last-prompt' && j.lastPrompt) out.prompt = j.lastPrompt;
    if (j.timestamp && !j.isSidechain) out.lastAt = j.timestamp;
    // 턴이 끝났나: 마지막 의미 있는 기록이 "멈춤 훅 요약"이거나 끝맺는 답이면 끝, 사람 말·도구 호출·도구 결과면 아직 도는 중
    // (긴 턴은 사람 말이 읽은 끝부분 밖에 있을 수 있어서 마지막 기록으로 본다)
    const p = promptText(j);
    if (p) { out.ended = false; out.prompt = p; out.tool = null; out.text = null; }
    else if (j.type === 'user' && !j.isSidechain && Array.isArray(j.message?.content)) out.ended = false;   // 도구 결과
    if (j.type === 'system' && j.subtype === 'stop_hook_summary') out.ended = true;
    if (j.type === 'assistant' && !j.isSidechain && Array.isArray(j.message?.content)) {
      const c = j.message.content;
      out.ended = j.message.stop_reason === 'end_turn' && !c.some((b) => b.type === 'tool_use');
      for (const b of c) {
        if (b.type === 'tool_use') {
          out.tool = { name: b.name, arg: toolArg(b.input) };
          const s = JSON.stringify(b.input ?? {}).replace(/\\\\/g, '\\');
          for (const m of s.matchAll(WIN_PATH)) out.paths.push(m[0]);
          for (const m of s.matchAll(TASK_ID)) refs.add(m[0]);
        } else if (b.type === 'text' && b.text?.trim()) {
          out.text = clip(b.text.replace(/[*`#>|]+/g, ''), 160);
          for (const m of b.text.matchAll(TASK_ID)) refs.add(m[0]);
        }
      }
    }
  }
  if (p0(out.prompt)) for (const m of out.prompt.matchAll(TASK_ID)) refs.add(m[0]);
  out.paths = out.paths.slice(-60);
  out.taskRefs = [...refs];
  out.title = out.title ? out.title.replace(/^[-–\s]+/, '').trim() : null;
  return out;
}
const p0 = (s) => typeof s === 'string' && s.length > 0;

function readTail(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const n = Math.min(size, TAIL);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    const s = buf.toString('utf8');
    return n < size ? s.slice(s.indexOf('\n') + 1) : s;
  } finally { fs.closeSync(fd); }
}

// ── 어디 일인지: 경로를 부서·하위 항목·공정에 맞춘다 ──
// 규칙 하나 = 경로 조각. 드라이브로 시작하면 앞부분 일치, 아니면 어디든 들어 있으면 일치. 가장 구체적인 규칙이 이긴다.
export function makeRules({ depts = [], units = [], processes = [] }) {
  const rules = [];
  const add = (needle, target, seg = false) => {
    const n = norm(needle);
    if (n.length >= 3) rules.push({ n, abs: /^[a-z]:\\/.test(n), seg, target });
  };
  // 여러 부서가 같은 workdir(보관함·D:\AI Project)을 쓰면 그 경로로는 가려 낼 수 없다
  const shared = new Map();
  for (const d of depts) if (d.workdir) shared.set(norm(d.workdir), (shared.get(norm(d.workdir)) ?? 0) + 1);
  for (const d of depts) {
    const t = { dept: d.name };
    if (d.workdir && shared.get(norm(d.workdir)) === 1) add(d.workdir, t);
    for (const m of d.match ?? []) add(m, t);
  }
  for (const u of units) {
    const t = { dept: u.dept, unit: u.name };
    if (u.workdir) add(u.workdir, t);
    for (const m of u.match ?? []) add(m, t);
    add(u.name, t, true);   // 경로 안의 폴더 이름 (…\영화리뷰\…)
  }
  for (const p of processes) if (p.workdir) add(p.workdir, { dept: p.dept, unit: p.unit ?? null, proc: p.id });
  return rules;
}

// 더 좁은 자리(공정 > 하위 항목 > 부서)가 먼저, 같은 자리끼리는 긴 규칙이 먼저
const rank = (r) => (r.target.proc ? 2000 : r.target.unit ? 1000 : 0) + r.n.length;
function matchOne(rules, p) {
  const s = norm(p);
  let best = null;
  for (const r of rules) {
    const hit = r.abs ? s === r.n || s.startsWith(`${r.n}\\`)
      : r.seg ? s.includes(`\\${r.n}\\`) || s.endsWith(`\\${r.n}`)
        : s.includes(r.n);
    if (hit && (!best || rank(r) > rank(best))) best = r;
  }
  return best?.target ?? null;
}

// 최근 경로일수록 무겁게 센다
export function classify(rules, paths) {
  const tally = (m, k, w) => m.set(k, (m.get(k) ?? 0) + w);
  const dept = new Map(), unit = new Map(), proc = new Map();
  paths.forEach((p, i) => {
    const t = matchOne(rules, p);
    if (!t) return;
    const w = 1 + i / Math.max(1, paths.length);
    tally(dept, t.dept, w);
    if (t.unit) tally(unit, `${t.dept}\u0000${t.unit}`, w);
    if (t.proc) tally(proc, t.proc, w);
  });
  const top = (m, ok = () => true) => [...m].filter(([k]) => ok(k)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const d = top(dept);
  if (!d) return { dept: null, unit: null, proc: null };
  const u = top(unit, (k) => k.startsWith(`${d}\u0000`));
  return { dept: d, unit: u ? u.split('\u0000')[1] : null, proc: top(proc) };
}

// 세션 자리: 세션을 연 폴더(cwd)가 어느 자리에 맞으면 그 자리 일이다 — 지나가며 만진 남의 폴더 경로로 옮기지 않는다.
// cwd로 못 가리면(빈 폴더·임시 폴더) 만진 경로로 가린다.
export function place(rules, cwd, paths = []) {
  const home = cwd ? classify(rules, [cwd]) : { dept: null, unit: null, proc: null };
  if (home.dept) {
    // 같은 부서 안에서 더 좁은 하위 항목·공정이 보이면 그것까지는 따른다
    const near = classify(rules, paths.filter(Boolean));
    return near.dept === home.dept ? { dept: home.dept, unit: home.unit ?? near.unit, proc: home.proc ?? near.proc } : home;
  }
  return classify(rules, paths.filter(Boolean));
}

// 말로 가리기: 폴더·경로로 못 가린 세션(임시 폴더 등)은 사람 말에 든 낱말을 match의 경로 조각이 아닌 낱말과 맞춘다.
// 가장 좁은 자리·긴 낱말이 이긴다.
export function byText(rules, text) {
  const s = String(text ?? '').toLowerCase();
  let best = null;
  for (const r of rules) if (!r.abs && !r.seg && s.includes(r.n) && (!best || rank(r) > rank(best))) best = r;
  return best ? { dept: best.target.dept, unit: best.target.unit ?? null, proc: best.target.proc ?? null } : { dept: null, unit: null, proc: null };
}

// ── 프로세스 표본: 세션 claude.exe·프로그램 찾기와 몫 계산 ──
function indexSample(sample) {
  const procs = sample?.procs ?? [];
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = new Map();
  for (const p of procs) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)).push(p);
  const subtree = (pid, seen = new Set()) => {
    const out = [];
    const walk = (id) => {
      const p = byPid.get(id);
      if (!p || seen.has(id)) return;
      seen.add(id);
      out.push(p);
      for (const c of kids.get(id) ?? []) if (c.pid !== id) walk(c.pid);
    };
    walk(pid);
    return out;
  };
  return { procs, byPid, kids, subtree };
}

const round = (n) => Math.round(n * 10) / 10;
function share(list, { cores, ramTotal, vramTotal }) {
  const s = { cpu: 0, mem: 0, gpu: 0, vram: 0 };
  for (const p of list) { s.cpu += p.cpu; s.mem += p.mem; s.gpu += p.gpu; s.vram += p.vram; }
  return {
    cpu: round(s.cpu / cores), mem: s.mem, memPct: ramTotal ? round((s.mem / ramTotal) * 100) : 0,
    gpu: round(Math.min(100, s.gpu)), vram: s.vram, vramPct: vramTotal ? round((s.vram / vramTotal) * 100) : 0,
  };
}

function programLabel(p) {
  const name = p.name.replace(/\.exe$/i, '');
  const script = p.cmd?.match(/([\w.-]+\.(?:py|mjs|cjs|js|ts))\b/i)?.[1];
  if (/^ollama$/i.test(name)) return 'ollama · 이 PC의 AI';
  if (/^ffmpeg$/i.test(name)) return 'ffmpeg · 렌더·인코딩';
  if (/^ffprobe$/i.test(name)) return 'ffprobe';
  return script ? `${name} · ${script}` : name;
}

// 표본 하나에서 세션 pid와 AI 프로그램 묶음을 뽑는다
export function readPrograms(sample, { rules, serverPid = process.pid, cores = os.cpus().length, ramTotal = os.totalmem() }) {
  const idx = indexSample(sample);
  const opts = { cores, ramTotal, vramTotal: sample?.gpu?.memTotal ?? 0 };
  const sessionPid = new Map();   // 세션 id → claude.exe pid
  const pidSession = new Map();
  for (const p of idx.procs) {
    const m = /^claude\.exe$/i.test(p.name) && p.cmd?.match(SESSION_ARG);
    if (m) { sessionPid.set(m[1], p.pid); pidSession.set(p.pid, m[1]); }
  }
  const brain = new Set(idx.subtree(serverPid).map((p) => p.pid));   // 두뇌 서버와 그 아래(두뇌 세션·측정기)는 뺀다
  const ownerOf = (p) => {
    for (let q = p, n = 0; q && n < 40; q = idx.byPid.get(q.ppid), n += 1) {
      if (pidSession.has(q.pid)) return pidSession.get(q.pid);
      if (q.ppid === q.pid) break;
    }
    return null;
  };
  const cands = idx.procs.filter((p) => PROGRAM.test(p.name) && p.cmd && !INTERNAL.test(p.cmd) && !brain.has(p.pid));
  const candPids = new Set(cands.map((p) => p.pid));
  const where = new Map(cands.map((p) => [p.pid, classify(rules, [...(p.cmd.match(WIN_PATH) ?? [])])]));
  // 경로가 없는 node(상대 경로로 띄운 서버)는 자식 프로그램의 자리를 따른다 (javManager node → ollama)
  for (const p of cands) {
    if (where.get(p.pid).dept) continue;
    const kid = (idx.kids.get(p.pid) ?? []).find((c) => where.get(c.pid)?.dept);
    if (kid) where.set(p.pid, where.get(kid.pid));
  }
  // 위쪽 후보가 있는 프로세스는 그 묶음에 들어간다 (ffmpeg 아래 ffprobe 따로 세지 않기)
  const roots = cands.filter((p) => !candPids.has(p.ppid));
  const groups = new Map();
  for (const p of roots) {
    const w = where.get(p.pid);
    const owner = ownerOf(p);
    const key = `${p.name.toLowerCase()}|${owner ?? ''}|${w.dept ?? ''}/${w.unit ?? ''}|${programLabel(p)}`;
    const g = groups.get(key) ?? groups.set(key, { key, name: p.name.replace(/\.exe$/i, ''), label: programLabel(p), session: owner, ...w, pids: [], list: [] }).get(key);
    g.pids.push(p.pid);
    g.list.push(...idx.subtree(p.pid));
  }
  const programs = [...groups.values()].map(({ list, ...g }) => ({ ...g, count: g.pids.length, ...share(list, opts) }))
    // 어디 일인지도, 어느 세션 일인지도 모르면 무거울 때만 (조용한 python 하나까지 다 올리면 지도가 시끄럽다)
    .filter((g) => g.dept || g.session || g.cpu >= 5 || g.gpu >= 5);
  const sessionShare = (id) => (sessionPid.has(id) ? share(idx.subtree(sessionPid.get(id)), opts) : null);
  return { programs, sessionPid, sessionShare };
}

// ── 묶기 ──
export function createActivity({ store, monitor, hooks = null, codex = null, projectsDir = path.join(os.homedir(), '.claude', 'projects'), now = () => Date.now() }) {
  const parsed = new Map();   // 파일 → { mtime, size, data } (바뀐 파일만 다시 읽는다)
  const placed = new Map();   // 세션 id → 마지막으로 가린 자리 (최근 기록에 경로가 없을 때 그대로 둔다)
  let cache = null;

  function transcripts(t) {
    const out = [];
    let dirs = [];
    try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
    for (const d of dirs) {
      const dir = path.join(projectsDir, d.name);
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
      for (const n of names) {
        const file = path.join(dir, n);
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        if (t - st.mtimeMs > ACTIVE_MS) continue;
        let c = parsed.get(file);
        if (!c || c.mtime !== st.mtimeMs) {
          try { c = { mtime: st.mtimeMs, data: parseTranscript(readTail(file, st.size)) }; } catch { continue; }
          parsed.set(file, c);
        }
        out.push({ id: n.slice(0, -6), mtime: st.mtimeMs, ...c.data });
      }
    }
    return out;
  }

  function snapshot() {
    const t = now();
    if (cache && t - cache.at < CACHE_MS) return cache;
    const tasks = store.listTasks();
    const brainSessions = new Set(tasks.map((x) => x.session).filter(Boolean));
    const open = new Map(tasks.filter((x) => ['실행중', '결정대기', '대기예약', '검수'].includes(x.status)).map((x) => [x.id, x]));
    const rules = makeRules({ depts: store.depts(), units: store.units(), processes: store.processes() });
    const sample = monitor?.raw?.() ?? null;
    const prog = readPrograms(sample, { rules });

    const sessions = transcripts(t).filter((s) => !brainSessions.has(s.id)).map((s) => {
      // 훅으로 연결된 세션은 사건으로 안 상태가 먼저 (기록 파일 짐작은 훅이 없을 때만)
      const h = hooks?.get(s.id) ?? null;
      let where = place(rules, s.cwd, [...s.paths, ...(h?.paths ?? [])]);
      if (where.dept) placed.set(s.id, where);
      else where = placed.get(s.id) ?? where;
      const quiet = t - Math.max(s.mtime, Date.parse(s.lastAt) || 0);
      const guess = !s.ended ? (quiet < WORKING_MS ? '작업중' : '응답없음') : '쉬는중';
      const state = h ? (h.state === '작업중' && t - Date.parse(h.lastAt) > WORKING_MS * 3 ? '응답없음' : h.state) : guess;
      return {
        id: s.id, title: s.title || clip(s.prompt, 40) || path.basename(s.cwd ?? '') || s.id.slice(0, 8),
        cwd: s.cwd, state, open: prog.sessionPid.has(s.id), lastAt: s.lastAt ?? new Date(s.mtime).toISOString(),
        prompt: clip(h?.prompt ?? s.prompt, 200), tool: h ? h.tool : s.tool, text: s.text, ...where,
        hooked: !!h, notice: h?.notice ?? null, events: h?.events ?? [], pending: h?.pending ?? null,
        // 잇기: 이름이 나온 열린 작업 중 같은 부서(하위 항목이 둘 다 있으면 같은 하위 항목) 것만 — 지나가며 언급한 남의 작업은 잇지 않는다
        tasks: s.taskRefs.filter((id) => {
          const x = open.get(id);
          return x && x.dept === where.dept && (!x.unit || !where.unit || x.unit === where.unit);
        }),
        usage: prog.sessionShare(s.id),
      };
    });
    // 코덱스 세션 (사람이 연 대화만 — 일회성 호출은 작업 기록에만 묶인다). 훅이 없어 기록 파일로만 짐작한다
    for (const c of codex?.live?.(ACTIVE_MS) ?? []) {
      let where = place(rules, c.cwd, c.paths);
      if (!where.dept) where = byText(rules, `${c.title ?? ''} ${c.prompts.map((p) => p.text).join(' ')}`);
      const quiet = t - c.mtime;
      sessions.push({
        id: c.id, agent: 'codex', title: `코덱스 · ${c.title || path.basename(c.cwd ?? '') || c.id.slice(0, 8)}`,
        cwd: c.cwd, state: !c.ended ? (quiet < WORKING_MS ? '작업중' : '응답없음') : '쉬는중', open: false,
        lastAt: c.end ?? new Date(c.mtime).toISOString(), prompt: clip(c.prompts.at(-1)?.text, 200), tool: null, text: clip(c.last, 160),
        ...where, hooked: false, notice: null, events: [], pending: null, tasks: [], usage: null,
      });
    }
    sessions.sort((a, b) => (b.lastAt > a.lastAt ? 1 : -1));
    const known = new Set(sessions.map((s) => s.id));
    // 프로그램: 기록이 보이는 세션 아래 것만 세션에 붙이고, 같은 하위 항목에서 도는 바깥 작업(신호를 남기는 작업)과 잇는다
    const programs = prog.programs.map((g) => {
      const session = known.has(g.session) ? g.session : null;
      const links = !session && g.unit ? [...open.values()].filter((x) => x.dept === g.dept && x.unit === g.unit && x.status === '실행중').map((x) => x.id) : [];
      return { ...g, session, tasks: links };
    });
    cache = { at: t, warming: !sample, sessions, programs };
    return cache;
  }

  return { snapshot, invalidate: () => { cache = null; } };
}
