// 배움 → 스킬: 일하다 알게 된 것을 모으고, 모이면 스킬로 만든다.
//
//   1. 모으기  기억/배움-<날>.md 에 한 줄씩 쌓는다 (하루 한 파일, 사람이 읽을 수 있게)
//        - 세션이 일하다 바로 남김 (runner 도구 note_learning)          by 세션
//        - 저녁마다 그날 기록(고쳐 말한 것·다시 연 이유·바깥 세션 대화)에서 뽑음  by 추출
//        - 사람이 화면에서 직접 적음                                       by 사람
//      줄 모양: - 13:20 **주의** · 세션 · 개발실/두뇌앱 · [[W-261118-002]] · 스킬 win-app-release — 내용 ^L-261118-03
//   2. 묶기    아직 안 쓴 배움을 읽기만 하는 세션이 읽고 "새 스킬 / 있는 스킬 고침" 제안을 만든다
//              → 결정(kind 스킬) "스킬로 만들까요?" — 사람이 고르면 스킬관리부 작업이 SKILL.md를 쓴다
//   3. 상태    기억/배움-상태.json  { items: {L-…: {status: 제안|스킬|버림, decision, job(스킬관리부 작업), skill, at}}, runs: {extract, propose} }
// 파일은 서버만 쓴다. 기존 줄은 고치지 않고 덧붙이기만 한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { ASK_MODEL } from './ask.mjs';

export const KINDS = ['방법', '주의', '선호', '도구'];
export const KIND_HINT = { 방법: '이렇게 하면 된다 (절차·요령)', 주의: '이렇게 하면 안 된다 (함정·오류와 해결)', 선호: '사람이 원하는 모양·기준', 도구: '도구·명령·경로 사용법' };
export const BY = ['세션', '추출', '사람'];
export const LEARN_REL = (date) => `기억/배움-${date}.md`;
export const STATE_REL = '기억/배움-상태.json';
export const SKILL_OPTIONS = ['만든다', '고쳐서 만든다 (메모에 고칠 점)', '버린다'];
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

const p2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const stampOf = (d) => `${ymd(d)}T${hm(d)}`;
const one = (s, n = 300) => { const t = String(s ?? '').replace(/\s+/g, ' ').replace(/ \^L-\S+/g, '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// 키·토큰처럼 보이는 긴 덩어리는 가린다
const scrub = (s) => String(s ?? '').replace(/[A-Za-z0-9_\-+/=]{32,}/g, '(가림)');

const LINE = /^-\s+(\d{2}:\d{2})\s+\*\*(.+?)\*\*\s+(.*?)\s+—\s+(.*?)\s+\^(L-\d{6}-\d{2,})\s*$/;

export function parseLessons(body, date) {
  const out = [];
  for (const raw of String(body ?? '').split('\n')) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const [, time, kind, meta, text, id] = m;
    const parts = meta.split(' · ').map((x) => x.trim()).filter(Boolean);
    const l = { id, date, time, kind, by: null, dept: null, unit: null, task: null, skill: null, text: text.trim() };
    for (const x of parts) {
      if (BY.includes(x)) l.by = x;
      else if (/^\[\[[^\]]+\]\]$/.test(x)) l.task = x.slice(2, -2);
      else if (x.startsWith('스킬 ')) l.skill = x.slice(3).trim();
      else { const [d, u] = x.split('/'); l.dept = d || null; l.unit = u || null; }
    }
    out.push(l);
  }
  return out;
}

export function readState(root) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
    return { items: s.items ?? {}, runs: s.runs ?? {} };
  } catch { return { items: {}, runs: {} }; }
}
export function writeState(root, state) {
  fs.mkdirSync(path.join(root, '기억'), { recursive: true });
  fs.writeFileSync(path.join(root, STATE_REL), JSON.stringify(state, null, 2));
}

// 보관함의 배움 파일 전부 (최근 날짜부터), 상태를 붙여서
export function readLessons(root, { days = 60 } = {}) {
  const dir = path.join(root, '기억');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /^배움-\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort().reverse().slice(0, days); } catch { return []; }
  const { items } = readState(root);
  return names.flatMap((n) => parseLessons(fs.readFileSync(path.join(dir, n), 'utf8'), n.slice(3, 13)))
    .map((l) => ({ ...l, ...(items[l.id] ?? {}), status: items[l.id]?.status ?? '모음' }))
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
}

// 배움 한 줄 덧붙이기 → id
export function addLesson(root, { kind = '방법', text, by = '사람', dept = null, unit = null, task = null, skill = null, now = new Date() }) {
  const t = one(scrub(text));
  if (!t) throw Object.assign(new Error('배운 내용이 비었음'), { status: 400 });
  if (!KINDS.includes(kind)) kind = '방법';
  if (!BY.includes(by)) by = '사람';
  const date = ymd(now);
  const file = path.join(root, LEARN_REL(date));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let body = '';
  try { body = fs.readFileSync(file, 'utf8'); } catch {
    body = ['---', 'type: 배움', `date: ${date}`, '---', `# 배움 · ${date}`, '',
      '일하다 알게 된 것 — 방법·주의·선호·도구. 서버가 쌓는다(세션이 남김 · 저녁에 기록에서 뽑음 · 사람이 적음). 모이면 스킬관리부가 스킬로 만든다.', '',
      '## 기록', ''].join('\n');
  }
  const n = parseLessons(body, date).length + 1;
  const id = `L-${date.slice(2).replace(/-/g, '')}-${p2(n)}`;
  const scope = dept ? `${dept}${unit ? `/${unit}` : ''}` : null;
  const meta = [by, scope, task ? `[[${task}]]` : null, skill ? `스킬 ${one(skill, 40)}` : null].filter(Boolean).join(' · ');
  fs.writeFileSync(file, `${body.replace(/\n*$/, '\n')}- ${hm(now)} **${kind}** ${meta} — ${t} ^${id}\n`);
  return id;
}

export function setLessonState(root, ids, patch, { now = new Date() } = {}) {
  const s = readState(root);
  for (const id of ids) s.items[id] = { ...(s.items[id] ?? {}), ...patch, at: stampOf(now) };
  writeState(root, s);
}

// 지금 있는 스킬: ~/.claude/skills/*/SKILL.md 의 name·description (+ 보드 상태)
export function listSkills(dir = SKILLS_DIR) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name); } catch { return []; }
  const out = [];
  for (const n of names) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8'); } catch { continue; }
    const fm = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '';
    const get = (k) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '').trim() ?? '';
    out.push({ name: get('name') || n, dir: n, description: one(get('description'), 220) });
  }
  return out;
}

// ── 읽기만 하는 세션 (배움 뽑기 · 스킬 묶기 공용)
async function readOnly(queryFn, root, prompt, title) {
  let text = '';
  const it = queryFn({
    prompt,
    options: {
      cwd: root, model: ASK_MODEL, maxTurns: 16, permissionMode: 'default',
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'WebSearch', 'WebFetch', 'Task', 'TodoWrite'],
      canUseTool: async () => ({ behavior: 'deny', message: `${title}는 읽기만 한다` }),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: `# SYNAPSE BRAIN ${title}\n파일은 읽기만 한다. 답은 요청한 JSON만.` },
      settingSources: [], stderr: () => {},
    },
  });
  for await (const m of it) {
    if (m.type === 'assistant' && !m.parent_tool_use_id) {
      const t = m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (t) text = t;
    } else if (m.type === 'result' && typeof m.result === 'string' && m.result.trim()) text = m.result.trim();
  }
  return text;
}
const jsonArray = (text) => {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text.match(/\[[\s\S]*\]/)?.[0] ?? '[]';
  try { const a = JSON.parse(block); return Array.isArray(a) ? a : []; } catch { return []; }
};
const str = (v, n = 300) => (typeof v === 'string' && v.trim() ? one(v, n) : null);

export function parseExtracted(text, max = 8) {
  return jsonArray(text).filter((x) => x && str(x.text)).slice(0, max).map((x) => ({
    kind: KINDS.includes(x.kind) ? x.kind : '방법', text: str(x.text, 220),
    dept: str(x.dept, 30), unit: str(x.unit, 30), task: str(x.task, 20)?.replace(/^\[\[|\]\]$/g, '') ?? null,
    skill: str(x.skill, 40), why: str(x.why, 200) ?? '',
  }));
}

export function parseProposals(text, lessonIds, max = 4) {
  const known = new Set(lessonIds);
  return jsonArray(text).filter((x) => x && str(x.name) && Array.isArray(x.lessons)).map((x) => ({
    action: x.action === '스킬 고침' ? '스킬 고침' : '새 스킬',
    name: String(x.name).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48),
    title: str(x.title, 40) ?? x.name, why: str(x.why, 400) ?? '',
    lessons: x.lessons.map(String).filter((id) => known.has(id)),
    outline: Array.isArray(x.outline) ? x.outline.map((s) => str(s, 160)).filter(Boolean).slice(0, 10) : [],
    triggers: Array.isArray(x.triggers) ? x.triggers.map((s) => str(s, 60)).filter(Boolean).slice(0, 8) : [],
  })).filter((p) => p.name && p.lessons.length).slice(0, max);
}

const EXTRACT_PROMPT = ({ date, files, known, scopes, skills }) => [
  `${date} 기록에서 "배움"을 뽑아라 — 일하다 새로 알게 되어, 다음에 같은 일을 할 때 그대로 쓰면 시간을 아끼는 것.`,
  '',
  `읽을 파일(보관함 기준): ${files.join(', ')}. 거기 링크된 작업 파일([[W-…]])의 진행 로그·결과도 필요한 만큼 읽는다.`,
  '',
  '좋은 배움:',
  '- 사람이 고쳐 말한 것("그게 아니라 ~", 다시 열기 이유, 결정 메모) → 선호',
  '- 실패했다가 해결한 방법(오류 문구와 해결) → 주의',
  '- 여러 단계를 거쳐 찾아낸 절차·경로·명령 → 방법 / 도구',
  '나쁜 배움: 한 번뿐인 사실("E023 올림"), 일반 상식, 이미 아는 것.',
  `- kind: ${KINDS.map((k) => `${k}(${KIND_HINT[k]})`).join(' · ')}`,
  '- text: 명령형이나 "~하면 ~된다" 한국어 한 줄(120자 안쪽), 누가 읽어도 바로 쓸 수 있게. 경로·명령은 그대로.',
  `- dept/unit: 이 중에서만, 모두에 맞으면 null: ${scopes}`,
  `- skill: 이미 있는 스킬에 들어가야 할 배움이면 그 스킬 이름, 아니면 null. 지금 스킬: ${skills || '(없음)'}`,
  `- 이미 모은 배움과 같은 뜻이면 뽑지 않는다:\n${known.length ? known.map((k) => `  - ${k}`).join('\n') : '  (없음)'}`,
  '- 많아야 8개. 없으면 빈 배열. 키·토큰·비밀번호·연봉 정보는 옮기지 않는다.',
  '',
  '답은 JSON 하나만 (```json 코드 블록 안에):',
  '[{"kind": "주의", "text": "…", "dept": "개발실" | null, "unit": "두뇌앱" | null, "task": "W-261118-002" | null, "skill": "win-app-release" | null, "why": "어느 기록에서"}]',
].join('\n');

const PROPOSE_PROMPT = ({ lessons, skills }) => [
  '모아 둔 "배움"을 스킬로 묶을 제안을 만들어라.',
  '',
  '스킬 = ~/.claude/skills/<name>/SKILL.md. 같은 종류의 일을 할 때 Claude가 불러 그대로 따르는 절차·주의점 묶음.',
  '- 같은 일(같은 도구·같은 산출물·같은 하위 항목)에 대한 배움 2개 이상이면 묶는다. 하나뿐이어도 시간을 크게 아끼는 절차면 묶어도 된다.',
  '- 이미 있는 스킬에 들어갈 배움이면 action "스킬 고침" + 그 스킬 name. 아니면 "새 스킬" + 새 name(영문 소문자-하이픈).',
  '- 선호(사람 취향)만 있는 묶음은 스킬보다 기억 카드가 맞다 — 제안하지 않는다.',
  '- outline: SKILL.md에 들어갈 단계·주의점 목록(한국어). triggers: 사람이 실제로 쓸 호출 말.',
  '- 많아야 4개. 묶을 게 없으면 빈 배열.',
  '',
  `지금 스킬:\n${skills.length ? skills.map((s) => `- ${s.name}: ${s.description}`).join('\n') : '(없음)'}`,
  '',
  `아직 스킬로 안 간 배움:\n${lessons.map((l) => `- ${l.id} [${l.kind}] ${l.dept ? `(${l.dept}${l.unit ? `/${l.unit}` : ''}) ` : ''}${l.skill ? `{스킬 ${l.skill}} ` : ''}${l.text}`).join('\n')}`,
  '',
  '답은 JSON 하나만 (```json 코드 블록 안에):',
  '[{"action": "새 스킬" | "스킬 고침", "name": "brain-app-dev", "title": "두뇌앱 개발", "why": "왜 묶는지", "lessons": ["L-261118-01"], "outline": ["…"], "triggers": ["…"]}]',
].join('\n');

// 스킬관리부 작업 지시문 (사람이 스킬 제안을 고르면)
export function skillInstruction(p, lessons, note) {
  const dir = path.join(SKILLS_DIR, p.name);
  return [
    `${p.action === '스킬 고침' ? `있는 스킬 \`${p.name}\`을 아래 배움으로 고친다` : `새 스킬 \`${p.name}\`(${p.title})을 만든다`} — 경로 \`${path.join(dir, 'SKILL.md')}\`.`,
    '',
    `### 왜\n${p.why}`,
    note ? `\n### 사람이 고쳐 달라고 한 점\n${note}` : null,
    '',
    '### 근거 배움',
    ...lessons.map((l) => `- ${l.id} [${l.kind}] ${l.text}${l.task ? ` ([[${l.task}]])` : ''}`),
    '',
    p.outline.length ? `### 들어갈 내용 (제안)\n${p.outline.map((o) => `- ${o}`).join('\n')}\n` : null,
    p.triggers.length ? `### 호출 말 (제안)\n${p.triggers.map((t) => `- ${t}`).join('\n')}\n` : null,
    '### 하는 법',
    '1. 스킬관리부 규칙 「일하는 순서」 3~5를 따른다(skill-creator 방식). description에는 무엇을 하는지 + 사람이 실제로 쓰는 호출 말.',
    `2. ${p.action === '스킬 고침' ? '기존 SKILL.md를 먼저 읽고, 바꾸기 전 사본을 `_backup`에 남긴 뒤 배움을 알맞은 단계·주의점 자리에 넣는다. 지우지 말고 고쳐 쓴다.' : '근거 배움이 나온 작업 기록을 읽고 실제 경로·명령·순서를 본문에 적는다.'}`,
    '3. 스킬보드 `skills.json`에 올리거나 고친다(status 다듬는중, history에 날짜·이유·배움 ID). 보드 게시는 규칙의 「보드 게시」대로.',
    '4. submit_result에 SKILL.md 경로와 무엇을 넣었는지 적는다.',
  ].filter((x) => x != null).join('\n').replace(/\n{3,}/g, '\n\n');
}

export function createLearn({ root, queryFn = sdkQuery, skillsDir = SKILLS_DIR, now = () => new Date() }) {
  let busy = null;
  const guard = async (what, fn) => {
    if (busy) throw Object.assign(new Error(`이미 ${busy} 중`), { status: 409 });
    busy = what;
    try { return await fn(); } finally { busy = null; }
  };

  // 그날 기록에서 배움 뽑기 → 배움 파일에 by 추출로 덧붙임
  function extract({ date = ymd(now()), scopes = [] } = {}) {
    return guard('배움 뽑기', async () => {
      const files = [`기억/주인말-${date}.md`, `기억/검수-${date}.md`, `기억/세션지시-${date}.md`].filter((f) => fs.existsSync(path.join(root, f)));
      const s = readState(root);
      s.runs.extract = stampOf(now());
      if (!files.length) { writeState(root, s); return { date, added: [] }; }
      const known = readLessons(root, { days: 30 }).map((l) => l.text).slice(0, 80);
      const skills = listSkills(skillsDir).map((x) => x.name).join(', ');
      const text = await readOnly(queryFn, root, EXTRACT_PROMPT({ date, files, known, scopes: scopes.join(', '), skills }), '배움 뽑기');
      const added = [];
      for (const x of parseExtracted(text)) added.push(addLesson(root, { ...x, by: '추출', now: now() }));
      writeState(root, { ...readState(root), runs: { ...readState(root).runs, extract: stampOf(now()) } });
      return { date, added };
    });
  }

  // 아직 안 쓴 배움 → 스킬 제안 목록 (결정은 서버가 만든다)
  function propose() {
    return guard('스킬 묶기', async () => {
      const open = readLessons(root, { days: 60 }).filter((l) => l.status === '모음');
      const s = readState(root);
      s.runs.propose = stampOf(now());
      writeState(root, s);
      if (!open.length) return { proposals: [], open };
      const text = await readOnly(queryFn, root, PROPOSE_PROMPT({ lessons: open, skills: listSkills(skillsDir) }), '스킬 묶기');
      return { proposals: parseProposals(text, open.map((l) => l.id)), open };
    });
  }

  return { extract, propose, busy: () => busy };
}
