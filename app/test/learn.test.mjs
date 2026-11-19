// 배움 → 스킬: 모으기(세션 도구·추출·사람) → 묶기(스킬 제안 결재) → 스킬관리부 작업
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addLesson, parseLessons, readLessons, setLessonState, parseExtracted, parseProposals, listSkills, createLearn, skillInstruction } from '../lib/learn.mjs';
import { createServer } from '../server.mjs';
import { loadVault, checkVault } from '../lib/vault.mjs';

const REAL_VAULT = path.join(import.meta.dirname, '..', '..', 'vault');
const tmp = (p = 'brain-learn-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const at = (h, m) => new Date(2026, 10, 18, h, m);

test('배움 한 줄: 덧붙이고 다시 읽으면 칸이 그대로 · id는 날짜별 번호 · 키처럼 보이는 것은 가림', () => {
  const root = tmp();
  const a = addLesson(root, { kind: '주의', text: 'Bash에서 \\\\ 가 뭉개진다 → 파이썬 패치 파일로', by: '세션', dept: '개발실', unit: '두뇌앱', task: 'W-261118-002', skill: 'win-app-release', now: at(13, 20) });
  const b = addLesson(root, { kind: '선호', text: `토큰 ${'x'.repeat(40)} 은 옮기지 않는다`, now: at(13, 25) });
  assert.equal(a, 'L-261118-01');
  assert.equal(b, 'L-261118-02');
  const body = fs.readFileSync(path.join(root, '기억', '배움-2026-11-18.md'), 'utf8');
  assert.match(body, /^type: 배움$/m);
  const [l1, l2] = parseLessons(body, '2026-11-18');
  assert.deepEqual({ ...l1 }, { id: a, date: '2026-11-18', time: '13:20', kind: '주의', by: '세션', dept: '개발실', unit: '두뇌앱', task: 'W-261118-002', skill: 'win-app-release', text: 'Bash에서 \\\\ 가 뭉개진다 → 파이썬 패치 파일로' });
  assert.equal(l2.by, '사람');
  assert.match(l2.text, /\(가림\)/);
  // 보관함 형식 검사도 통과 (새 문서 종류 배움)
  setLessonState(root, [a], { status: '제안', decision: 'D-1' });
  const ls = readLessons(root);
  assert.equal(ls.find((l) => l.id === a).status, '제안');
  assert.equal(ls.find((l) => l.id === b).status, '모음');
  assert.throws(() => addLesson(root, { text: '   ' }), /비었음/);
});

test('뽑기·묶기 답 풀기: 모르는 배움 ID와 이상한 이름은 거른다', () => {
  const ex = parseExtracted('```json\n[{"kind":"주의","text":"PS 5.1은 한글 ps1에 BOM이 필요","dept":"개발실","task":"[[W-1]]"},{"kind":"엉뚱","text":"x"},{"text":""}]\n```');
  assert.equal(ex.length, 2);
  assert.equal(ex[0].task, 'W-1');
  assert.equal(ex[1].kind, '방법');
  const pr = parseProposals('```json\n[{"action":"새 스킬","name":"Brain App Dev!","title":"두뇌앱 개발","lessons":["L-1","L-9"],"outline":["a"]},{"name":"x","lessons":["L-9"]}]\n```', ['L-1', 'L-2']);
  assert.equal(pr.length, 1);
  assert.equal(pr[0].name, 'brain-app-dev');
  assert.deepEqual(pr[0].lessons, ['L-1']);
  assert.match(skillInstruction(pr[0], [{ id: 'L-1', kind: '주의', text: 'BOM' }], '짧게'), /brain-app-dev[\s\S]*짧게[\s\S]*L-1/);
});

test('지금 스킬 목록: SKILL.md 머리말의 name·description (_로 시작하는 폴더는 뺌)', () => {
  const dir = tmp('brain-skills-');
  fs.mkdirSync(path.join(dir, 'win-app-release'));
  fs.writeFileSync(path.join(dir, 'win-app-release', 'SKILL.md'), '---\nname: win-app-release\ndescription: "윈도우 앱 배포"\n---\n본문');
  fs.mkdirSync(path.join(dir, '_backup'));
  assert.deepEqual(listSkills(dir), [{ name: 'win-app-release', dir: 'win-app-release', description: '윈도우 앱 배포' }]);
});

test('저녁 뽑기: 그날 기록을 읽기만 하는 세션이 준 배움을 "추출"로 쌓는다', async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '기억'), { recursive: true });
  fs.writeFileSync(path.join(root, '기억', '주인말-2026-11-18.md'), '---\ntype: 주인말\ndate: 2026-11-18\n---\n## 기록\n- 09:00 **지시** 그게 아니라 표는 880px로');
  const calls = [];
  const queryFn = ({ prompt, options }) => { calls.push({ prompt, options }); return (async function* () { yield { type: 'result', result: '```json\n[{"kind":"선호","text":"기획서 표 너비는 880px","dept":null}]\n```' }; })(); };
  const l = createLearn({ root, queryFn, skillsDir: tmp('brain-skills-'), now: () => at(18, 40) });
  const r = await l.extract({ date: '2026-11-18', scopes: ['기획실'] });
  assert.equal(r.added.length, 1);
  assert.deepEqual(calls[0].options.allowedTools, ['Read', 'Grep', 'Glob']);
  assert.match(calls[0].prompt, /기억\/주인말-2026-11-18\.md/);
  const [x] = readLessons(root);
  assert.equal(x.by, '추출');
  assert.equal(x.text, '기획서 표 너비는 880px');
});

// ── 서버 흐름: 사람이 적고 → 묶기 → 결재 → 스킬관리부 작업이 시작됨
function vault() {
  const root = tmp('brain-');
  for (const rel of ['CLAUDE.md', '지표/KPI.md', '부서/비서실/규칙.md', '부서/스킬관리부/규칙.md', '템플릿/작업.md', '템플릿/결정.md']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REAL_VAULT, rel), path.join(root, rel));
  }
  for (const d of ['비서실', '스킬관리부']) {
    const f = path.join(root, '부서', d, '규칙.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^workdir: .*$/m, `workdir: ${root.replace(/\\/g, '/')}`).replace(/^match:[\s\S]*?(?=^---)/m, ''));
  }
  return root;
}

test('서버: 배움 적기 → 스킬 제안(결정 kind 스킬) → 만든다 → 스킬관리부 작업 시작, 배움은 "스킬"로', async () => {
  const root = vault();
  const sessions = [];
  const queryFn = ({ prompt, options }) => {
    if (/스킬로 묶을 제안/.test(prompt)) {
      const ids = [...prompt.matchAll(/(L-\d{6}-\d{2})/g)].map((m) => m[1]);
      return (async function* () { yield { type: 'result', result: `\`\`\`json\n[{"action":"새 스킬","name":"ps-bom","title":"PowerShell 한글 스크립트","why":"두 번 겪음","lessons":${JSON.stringify([...new Set(ids)])},"outline":["BOM 붙이기"]}]\n\`\`\`` }; })();
    }
    sessions.push({ prompt, options });
    return (async function* () { yield { type: 'system', subtype: 'init', session_id: 's1' }; yield { type: 'result', subtype: 'success', result: '' }; })();
  };
  const srv = createServer({ root, port: 0, runner: { queryFn, skillsDir: tmp('brain-skills-') }, externalDir: path.join(root, '.external') });
  const port = await srv.listen();
  const api = async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  try {
    const a = await api('POST', '/api/learn', { text: 'PS 5.1은 한글 ps1에 UTF-8 BOM이 있어야 한다', kind: '주의' });
    const b = await api('POST', '/api/learn', { text: 'build.ps1이 brain-ctl에 BOM을 다시 붙인다', kind: '도구' });
    assert.equal(a.status, 200);
    let g = await api('GET', '/api/learn');
    assert.equal(g.json.lessons.length, 2);
    const p = await api('POST', '/api/learn/propose');
    assert.equal(p.json.count, 1);
    g = await api('GET', '/api/learn');
    assert.equal(g.json.pending.length, 1);
    assert.ok(g.json.lessons.every((l) => l.status === '제안'));
    const did = g.json.pending[0].id;
    const r = await api('POST', `/api/decisions/${did}`, { choice: 1 });
    assert.equal(r.status, 200);
    g = await api('GET', '/api/learn');
    assert.equal(g.json.pending.length, 0);
    assert.ok(g.json.lessons.every((l) => l.status === '스킬' && l.skill === 'ps-bom'));
    const job = g.json.lessons[0].job;
    assert.equal(g.json.lessons[0].task, null);                // 배움이 나온 작업(없음)은 그대로
    const t = (await api('GET', `/api/tasks/${job}`)).json;
    assert.equal(t.dept, '스킬관리부');
    assert.match(t.body, /ps-bom[\s\S]*BOM이 있어야/);
    for (let i = 0; i < 100 && !srv.runner.idle(); i++) await new Promise((res) => setTimeout(res, 10));
    assert.ok(sessions.some((s) => /ps-bom/.test(s.prompt)));
    assert.equal(sessions[0].options.mcpServers.brain.brainTools.some((x) => x.name === 'note_learning'), true);
    // 보관함 형식 검사 통과 (배움 파일·스킬 결정 포함)
    assert.deepEqual(checkVault(loadVault(root)).errors, []);
    // 버림 / 되살림
    assert.equal((await api('POST', `/api/learn/state/${a.json.id}`, { status: '버림' })).status, 200);
    assert.equal((await api('POST', `/api/learn/state/${a.json.id}`, { status: '이상함' })).status, 400);
    void b;
  } finally { srv.close(); }
});

test('세션 도구 note_learning: 작업의 부서·하위와 작업 ID를 붙여 배움으로 남긴다', async () => {
  const root = vault();
  let opts = null;
  const queryFn = ({ options }) => { opts = options; return (async function* () { yield { type: 'system', subtype: 'init', session_id: 's1' }; yield { type: 'result', subtype: 'success', result: '' }; })(); };
  const srv = createServer({ root, port: 0, runner: { queryFn }, externalDir: path.join(root, '.external') });
  await srv.listen();
  try {
    const id = await srv.store.createTask({ dept: '비서실', title: '시험', instruction: '해' });
    srv.runner.start(id);
    for (let i = 0; i < 100 && !opts; i++) await new Promise((res) => setTimeout(res, 10));
    const tool = opts.mcpServers.brain.brainTools.find((x) => x.name === 'note_learning');
    const out = await tool.handler({ kind: '주의', text: 'conhost --headless로 띄우면 창이 안 뜬다' }, {});
    assert.match(out.content[0].text, /L-\d{6}-01/);
    assert.match(opts.systemPrompt.append, /note_learning/);
    const [l] = readLessons(root);
    assert.equal(l.task, id);
    assert.equal(l.dept, '비서실');
    assert.equal(l.by, '세션');
  } finally { srv.close(); }
});
