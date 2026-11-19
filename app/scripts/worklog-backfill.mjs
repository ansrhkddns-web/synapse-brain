// Claude 작업 기록 채우기: 훅이 놓친 세션(훅을 켜기 전에 열려 있던 세션 등)을 대화 기록에서 찾아 작업 파일로 만든다.
//   node scripts/worklog-backfill.mjs [--since 2026-11-02T17:00] [--dry]
//   - since(한국 시간) 뒤에 사람 말이 있는데 기록(태그 cc-<세션 id>)이 없는 세션만. 두뇌가 띄운 세션은 뺀다.
//   - 이미 있는 바깥 세션 기록은 이름을 세션 제목으로 맞추고 태그 '자동이름'을 붙인다(사람이 이름을 바꾼 기록은 그대로).
// 서버가 켜져 있어도 된다: 서버는 모르는 세션의 말이 오면 보관함을 다시 훑어 이 기록을 이어 쓴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../lib/store.mjs';
import { makeRules, place, byText } from '../lib/activity.mjs';
import { TAG, AUTO_NAME, sessionTitle, sessionOf, isTracked } from '../lib/worklog.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dry = process.argv.includes('--dry');
const since = Date.parse(`${arg('--since', new Date(Date.now() + 9 * 3600_000 - 86400_000).toISOString().slice(0, 16))}+09:00`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vault');
const store = createStore(root);
const base = path.join(os.homedir(), '.claude', 'projects');

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const redact = (s) => String(s ?? '').replace(/[A-Za-z0-9_\-+/=]{24,}/g, '(가림)');
const human = (s) => String(s ?? '').replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/g, '').trim();
const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(5, 16).replace('T', ' ');

// 대화 기록 하나 읽기: 작업 폴더, 사람 말(시각), 만진 경로, 마지막 답
function readSession(file) {
  const out = { cwd: null, prompts: [], paths: [], last: null };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.isSidechain) continue;
    if (j.cwd && !out.cwd) out.cwd = j.cwd;
    if (j.type === 'user' && !j.isMeta && j.timestamp) {
      const c = j.message?.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b) => b.type === 'tool_result') ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
      const h = human(t);
      if (h) out.prompts.push({ at: j.timestamp, text: h });
    }
    if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
      for (const b of j.message.content) {
        if (b.type === 'tool_use') for (const m of JSON.stringify(b.input ?? {}).replace(/\\\\/g, '\\').matchAll(/[A-Za-z]:[\\/][^"'`\n\r|<>*?;]+/g)) out.paths.push(m[0]);
        else if (b.type === 'text' && b.text?.trim()) out.last = b.text;
      }
    }
  }
  out.paths = out.paths.slice(-60);
  return out;
}

const tasks = store.listTasks();
const brain = new Set(tasks.map((t) => t.session).filter(Boolean));
const recorded = new Map(tasks.filter(isTracked).map((t) => [sessionOf(t), t]));
const files = new Map();
for (const d of fs.readdirSync(base)) {
  const dir = path.join(base, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) files.set(f.slice(0, -6), path.join(dir, f));
}
const rules = makeRules({ depts: store.depts(), units: store.units(), processes: store.processes() });

// 1) 놓친 세션 → 기록
let made = 0;
for (const [sid, file] of files) {
  if (brain.has(sid) || recorded.has(sid) || fs.statSync(file).mtimeMs < since) continue;
  const s = readSession(file);
  const fresh = s.prompts.filter((p) => Date.parse(p.at) >= since);
  if (!fresh.length) continue;
  // 임시 폴더·작업 루트 바로 아래에서 연 세션은 폴더가 일을 말해 주지 않는다 → 제목·말의 낱말 먼저
  const loose = /scratch-workspaces/i.test(s.cwd ?? '') || (!!s.cwd && path.resolve(s.cwd).toLowerCase() === path.dirname(path.dirname(root)).toLowerCase());
  const said = `${sessionTitle(file) ?? ''} ${fresh.map((p) => p.text).join(' ')}`;
  let w = loose ? byText(rules, said) : place(rules, s.cwd, s.paths);
  if (!w.dept) w = loose ? place(rules, s.cwd, s.paths) : byText(rules, said);
  const where = w.dept ? { dept: w.dept, unit: w.unit ?? null } : { dept: '비정규직', unit: null };
  const title = sessionTitle(file) ?? clip(redact(fresh[0].text), 60);
  // 하루 안에 움직인 세션만 "새 답"(검수)으로, 그 전 것은 지난 기록이라 완료로 채운다 (데스크가 넘치지 않게)
  const recent = Date.now() - Date.parse(fresh.at(-1).at) < 24 * 3600_000;
  const history = fresh.map((p) => `- ${kst(p.at)} ${clip(redact(p.text), 140)}`).join('\n');
  console.log(`${dry ? '(시험) ' : ''}새 기록: ${title} → ${where.dept}${where.unit ? ` / ${where.unit}` : ''} · 사람 말 ${fresh.length}건`);
  if (dry) continue;
  const id = await store.createTask({
    ...where, status: recent ? '검수' : '완료', title,
    instruction: `${redact(fresh[0].text).slice(0, 2000)}\n\n> Claude Code 세션 \`${sid}\` · 작업 폴더 \`${s.cwd ?? '?'}\` — 훅이 켜지기 전에 열려 있던 세션이라 대화 기록에서 채웠다.\n\n### 기록 전 대화 (사람 말)\n\n${history}`,
    tags: [TAG, '자동배정', AUTO_NAME, `cc-${sid}`],
  });
  await store.appendLog(id, `배정 → ${where.dept}${where.unit ? ` / ${where.unit}` : ''} · 대화 기록에서 채움 (사람 말 ${fresh.length}건, ${kst(fresh[0].at)} ~ ${kst(fresh.at(-1).at)})`);
  await store.setResult(id, `${clip(redact(human(s.last)), 700) || '(마지막 답 없음)'}\n\n> 대화 기록의 마지막 답. 이어서 일하면 다시 실행중이 된다.`, recent ? '검수' : '완료');
  if (!recent) await store.appendLog(id, '지난 기록 채움 — 완료로 둠 (다시 말하면 실행중으로 열린다)');
  made++;
}

// 2) 이미 있는 기록 → 이름을 세션 제목으로, 자동이름 태그
let renamed = 0;
for (const [sid, t] of recorded) {
  const { body } = store.readTask(t.id);
  if (/사용자가 이름 변경/.test(body) || t.tags.includes(AUTO_NAME)) continue;
  const name = sessionTitle(files.get(sid));
  console.log(`${dry ? '(시험) ' : ''}이름: ${t.id} ${t.title} → ${name ?? '(세션 제목 없음, 그대로)'}`);
  if (dry) continue;
  await store.patchTask(t.id, { tags: [...t.tags, AUTO_NAME] });
  if (name && name !== t.title) { await store.renameTask(t.id, name, '세션 제목으로'); renamed++; }
}
console.log(`새 기록 ${made}개 · 이름 맞춤 ${renamed}개`);
