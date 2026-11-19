// 스킬관리부 수집기: 이 PC의 Claude Code·Codex 대화 기록에서 "내가 Claude로 한 일"을 모아 스킬 후보를 찾을 재료를 만든다.
//   node scripts/skill-harvest.mjs [--since 2026-06-01] [--out <폴더>]
//   → <out>/actions-YYYY-MM-DD.json : 세션마다 부서·하위(작업 기록 규칙과 같은 배정)·제목·사람 말·도구·스킬·커넥터·게시
//   → <out>/actions-YYYY-MM-DD.md   : 사람이 읽는 요약 (자리별 세션 수, 많이 쓴 도구·스킬·커넥터, 되풀이된 말)
//   Codex: 사람이 연 세션은 하나씩(agent codex), 일회성 호출(codex exec)은 날짜·폴더로 묶어(agent codex-exec) 넣는다.
// 읽기만 한다. 사람 말은 200자까지, 키·토큰 모양 덩어리는 (가림). 두뇌가 띄운 세션도 넣는다(태그 brain).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../lib/store.mjs';
import { makeRules, place, byText } from '../lib/activity.mjs';
import { sessionTitle } from '../lib/worklog.mjs';
import { listRollouts, parseRollout, readThreadNames, isExecCall } from '../lib/codex.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const out = arg('--out', path.join(root, '부서작업', '스킬관리부', '스킬수집'));
const since = arg('--since', '2000-01-01');
const store = createStore(path.join(root, 'vault'));
const rules = makeRules({ depts: store.depts(), units: store.units(), processes: store.processes() });
const brain = new Set(store.listTasks().map((t) => t.session).filter(Boolean));
const base = path.join(os.homedir(), '.claude', 'projects');

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const redact = (s) => String(s ?? '').replace(/[A-Za-z0-9_\-+/=]{24,}/g, '(가림)');
const human = (s) => String(s ?? '').replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/g, '').trim();
const oldPc = (p) => p;   // 예전 PC의 경로를 지금 경로로 바꿔 볼 때 여기서
// 임시 폴더나 작업 루트 바로 아래에서 연 세션은 폴더가 일을 말해 주지 않는다
const LOOSE = { test: (p) => /scratch-workspaces/i.test(p) || (!!p && path.resolve(p).toLowerCase() === path.dirname(root).toLowerCase()) };
// mcp__<서버>__<도구> → 서버 이름 (긴 id는 앞 8자)
const mcpServer = (name) => { const m = name.match(/^mcp__(.+?)__/); return m ? (m[1].length > 30 ? m[1].slice(0, 8) : m[1]) : null; };
const bump = (o, k, n = 1) => { if (k) o[k] = (o[k] ?? 0) + n; };

const sessions = [];
for (const d of fs.readdirSync(base)) {
  const dir = path.join(base, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const file = path.join(dir, f);
    const id = f.slice(0, -6);
    const s = { id, cwd: null, start: null, end: null, prompts: [], tools: {}, skills: {}, mcp: {}, publishes: 0, paths: [] };
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.startsWith('{')) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.isSidechain) continue;
      if (j.cwd && !s.cwd) s.cwd = j.cwd;
      if (j.timestamp) { s.start ??= j.timestamp; s.end = j.timestamp; }
      // 맥락 요약(대화가 길어져 이어 붙인 것)은 사람 말이 아니다
      if (j.type === 'user' && !j.isMeta && !j.isCompactSummary) {
        const c = j.message?.content;
        const t = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b) => b.type === 'tool_result') ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
        const h = human(t);
        if (h && !/^This session is being continued/.test(h)) s.prompts.push({ at: j.timestamp, text: clip(redact(h), 200) });
      }
      if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
        for (const b of j.message.content) {
          if (b.type !== 'tool_use') continue;
          const server = mcpServer(b.name);
          bump(s.tools, server ? `mcp:${server}` : b.name);
          if (server) bump(s.mcp, server);
          if (b.name === 'Skill' && b.input?.skill) bump(s.skills, b.input.skill);
          if (b.name === 'Artifact' && (b.input?.action ?? 'publish') === 'publish') s.publishes++;
          for (const m of JSON.stringify(b.input ?? {}).replace(/\\\\/g, '\\').matchAll(/[A-Za-z]:[\\/][^"'`\n\r|<>*?;]+/g)) s.paths.push(m[0]);
        }
      }
    }
    if (!s.prompts.length || (s.end ?? '') < since) continue;
    const title = sessionTitle(file) ?? s.prompts[0].text.slice(0, 50);
    const said = `${title} ${s.prompts[0].text}`;
    let w = LOOSE.test(s.cwd ?? '') ? byText(rules, said) : place(rules, s.cwd, s.paths.slice(-60));
    if (!w.dept) w = LOOSE.test(s.cwd ?? '') ? place(rules, oldPc(s.cwd), s.paths.slice(-60).map(oldPc)) : byText(rules, said);
    sessions.push({
      id, title, cwd: s.cwd, dept: w.dept ?? '비정규직', unit: w.unit ?? null, brain: brain.has(id),
      start: s.start, end: s.end, turns: s.prompts.length, prompts: s.prompts,
      tools: s.tools, skills: s.skills, mcp: s.mcp, publishes: s.publishes,
    });
  }
}
// Codex 세션 (~/.codex/sessions)
const names = readThreadNames();
const execGroups = new Map();
for (const file of listRollouts()) {
  let c; try { c = parseRollout(fs.readFileSync(file, 'utf8')); } catch { continue; }
  if (!c.id || !c.prompts.length || (c.end ?? '') < since) continue;
  const prompts = c.prompts.map((p) => ({ at: p.at, text: clip(redact(p.text), 200) }));
  const title = names.get(c.id) ?? prompts[0].text.slice(0, 50);
  let w = LOOSE.test(c.cwd ?? '') ? byText(rules, `${title} ${prompts[0].text}`) : place(rules, c.cwd, c.paths);
  if (!w.dept) w = byText(rules, `${title} ${prompts[0].text}`);
  const base = { cwd: c.cwd, dept: w.dept ?? '비정규직', unit: w.unit ?? null, brain: false, tools: { 'codex:tool': c.calls }, skills: {}, mcp: {}, publishes: 0 };
  if (!isExecCall(c)) { sessions.push({ id: `codex-${c.id}`, agent: 'codex', title: `코덱스 · ${title}`, start: c.start, end: c.end, turns: prompts.length, prompts, ...base }); continue; }
  const key = `${c.start.slice(0, 10)}|${(c.cwd ?? '').toLowerCase()}`;
  const g = execGroups.get(key) ?? { id: `codex-exec-${key}`, agent: 'codex-exec', title: `코덱스 호출 · ${path.basename(c.cwd ?? '') || '?'}`, start: c.start, end: c.end, turns: 0, prompts: [], ...base, tools: {} };
  g.turns++; g.end = c.end > g.end ? c.end : g.end; g.start = c.start < g.start ? c.start : g.start;
  if (g.prompts.length < 20) g.prompts.push(prompts[0]);
  bump(g.tools, 'codex:tool', c.calls);
  execGroups.set(key, g);
}
for (const g of execGroups.values()) sessions.push({ ...g, title: `${g.title} (${g.turns}회)` });
sessions.sort((a, b) => a.start.localeCompare(b.start));

// 모아 보기
const total = { sessions: sessions.length, codex: sessions.filter((s) => s.agent === 'codex').length, codexCalls: sessions.filter((s) => s.agent === 'codex-exec').reduce((n, s) => n + s.turns, 0), turns: 0, tools: {}, skills: {}, mcp: {}, publishes: 0, places: {} };
for (const s of sessions) {
  total.turns += s.turns; total.publishes += s.publishes;
  for (const [k, v] of Object.entries(s.tools)) bump(total.tools, k, v);
  for (const [k, v] of Object.entries(s.skills)) bump(total.skills, k, v);
  for (const [k, v] of Object.entries(s.mcp)) bump(total.mcp, k, v);
  bump(total.places, `${s.dept}${s.unit ? ` / ${s.unit}` : ''}`);
}
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const date = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `actions-${date}.json`), JSON.stringify({ date, since, total, sessions }, null, 1));
const md = [
  `# 스킬 수집 · ${date}`, '',
  `세션 ${total.sessions}개(코덱스 대화 ${total.codex}개 · 코덱스 호출 ${total.codexCalls}회 포함) · 사람 말 ${total.turns}회 · 아티팩트 게시 ${total.publishes}회 (since ${since})`, '',
  '## 자리별 세션', '', '| 자리 | 세션 |', '|---|---|', ...top(total.places, 40).map(([k, v]) => `| ${k} | ${v} |`), '',
  '## 많이 쓴 도구', '', ...top(total.tools, 25).map(([k, v]) => `- ${k} ${v}`), '',
  '## 쓴 스킬', '', ...(top(total.skills, 40).map(([k, v]) => `- ${k} ${v}`).concat(Object.keys(total.skills).length ? [] : ['- (없음)'])), '',
  '## 쓴 커넥터', '', ...top(total.mcp, 25).map(([k, v]) => `- ${k} ${v}`), '',
  '## 세션', '', '| 시작 | 자리 | 말 | 제목 |', '|---|---|---|---|',
  ...sessions.map((s) => `| ${s.start.slice(0, 10)} | ${s.dept}${s.unit ? ` / ${s.unit}` : ''} | ${s.turns} | ${s.title.replace(/\|/g, '/')}${s.brain ? ' (두뇌)' : ''} |`), '',
].join('\n');
fs.writeFileSync(path.join(out, `actions-${date}.md`), md);
console.log(`${path.join(out, `actions-${date}.json`)} — 세션 ${total.sessions} · 말 ${total.turns}`);
