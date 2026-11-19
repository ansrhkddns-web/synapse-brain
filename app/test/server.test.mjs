// 가짜 SDK 세션으로 서버 흐름 전체를 시험한다 (실제 Claude 호출 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { loadVault, checkVault } from '../lib/vault.mjs';

const REAL_VAULT = path.join(import.meta.dirname, '..', '..', 'vault');

function tempVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));
  for (const rel of ['CLAUDE.md', '지표/KPI.md', '부서/리서치부/규칙.md', '부서/비서실/규칙.md', '템플릿/작업.md', '템플릿/결정.md']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REAL_VAULT, rel), path.join(root, rel));
  }
  // 부서 작업 폴더를 임시 폴더로
  for (const d of ['리서치부', '비서실']) {
    const f = path.join(root, '부서', d, '규칙.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^workdir: .*$/m, `workdir: ${root.replace(/\\/g, '/')}`));
  }
  return root;
}

const callTool = (options, name, args) => options.mcpServers.brain.brainTools.find((t) => t.name === name).handler(args, {});

// 대본대로 움직이는 가짜 세션: script(prompt, options, n번째 호출) → 메시지 배열
function fakeQuery(script) {
  const calls = [];
  const fn = ({ prompt, options }) => {
    const n = calls.push({ prompt, options }) - 1;
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: options.resume ?? `sess-${n}` };
      for (const step of await script(prompt, options, n)) yield step;
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, result: '' };
    })();
  };
  fn.calls = calls;
  return fn;
}

const say = (text) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } });
const used = (name) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: `mcp__brain__${name}` }] } });

const BAD_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

async function boot(script) {
  const root = tempVault();
  const queryFn = fakeQuery(script);
  // port 0이 fetch가 막는 포트(6000·6665 등)를 받을 때가 있어, 그러면 새로 띄운다
  let srv, port;
  for (let i = 0; i < 5; i++) {
    srv = createServer({ root, port: 0, runner: { queryFn }, externalDir: path.join(root, '.external') });
    port = await srv.listen();
    if (!BAD_PORTS.has(port)) break;
    srv.close();
  }
  const api = async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, {
      method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json() };
  };
  const settle = async () => { for (let i = 0; i < 100 && !srv.runner.idle(); i++) await new Promise((r) => setTimeout(r, 10)); };
  return { root, srv, api, settle, queryFn };
}

test('새 일 → 진행 기록 → 결정 요청 → 답 → 이어서 → 결과 제출', async () => {
  const { root, srv, api, settle, queryFn } = await boot(async (prompt, options, n) => {
    if (n === 0) {
      await callTool(options, 'log_progress', { text: '자료 찾는 중' });
      await callTool(options, 'request_decision', { title: '범위', options: ['영상 도구만', '전체'], recommended: 1, background: '양이 많음' });
      return [say('범위를 골라 주세요'), used('request_decision')];
    }
    const rid = (await callTool(options, 'write_report', { title: '트렌드', conclusions: ['a', 'b', 'c'], body: '본문', sources: ['https://example.com'] }))
      .content[0].text.match(/R-\d{6}-\d{3}/)[0];
    await callTool(options, 'submit_result', { summary: '정리 끝', reports: [rid] });
    return [say('끝'), used('submit_result')];
  });
  try {
    const { json: { id } } = await api('POST', '/api/tasks', { dept: '리서치부', instruction: '아침 AI 트렌드 정리해줘' });
    assert.match(id, /^W-\d{6}-001$/);
    await settle();

    let state = (await api('GET', '/api/state')).json;
    assert.equal(state.needsMe, 1);
    const dec = state.pending[0];
    assert.equal(state.tasks[0].status, '결정대기');
    assert.equal(state.tasks[0].session, 'sess-0');

    // 첫 세션은 지시문, 시스템 프롬프트에 부서 규칙이 붙는다
    assert.equal(queryFn.calls[0].prompt, '아침 AI 트렌드 정리해줘');
    assert.match(queryFn.calls[0].options.systemPrompt.append, /# 리서치부/);
    assert.equal(queryFn.calls[0].options.cwd.replace(/\\/g, '/'), root.replace(/\\/g, '/'));

    assert.equal((await api('POST', `/api/decisions/${dec.id}`, { choice: 2, note: '전부' })).status, 200);
    await settle();

    // 답은 같은 세션으로 이어진다
    assert.equal(queryFn.calls[1].options.resume, 'sess-0');
    assert.match(queryFn.calls[1].prompt, /2번 "전체".*메모: 전부/);

    const task = (await api('GET', `/api/tasks/${id}`)).json;
    assert.equal(task.status, '검수');
    assert.match(task.body, /자료 찾는 중/);

    // 결재함 아래 "내린 결정" 기록, 작업 하나의 이벤트 로그
    state = (await api('GET', '/api/state')).json;
    assert.deepEqual(state.decided.map((d) => [d.id, d.choice, d.answer, d.note]), [[dec.id, 2, '전체', '전부']]);
    const ev = (await api('GET', `/api/timeline?task=${id}`)).json;
    assert.equal(ev.length > 0 && ev.every((e) => e.task === id), true);
    assert.equal((await api('GET', '/api/timeline?task=W-000000-000')).json.length, 0);
    assert.match(task.body, /## 결과\n\n정리 끝\n\n### 결과물\n\n- \[\[R-\d{6}-001\]\]/);
    assert.equal(task.backlinks.some((b) => b.type === '결정'), true);

    // 서버가 쓴 파일이 형식 검사를 통과한다
    assert.deepEqual(checkVault(loadVault(root)).errors, []);

    assert.equal((await api('POST', `/api/decisions/${dec.id}`, { choice: 1 })).status, 409);
    assert.equal((await api('POST', `/api/tasks/${id}/status`, { status: '완료' })).status, 200);
    assert.equal((await api('GET', `/api/tasks/${id}`)).json.status, '완료');
    assert.equal((await api('GET', '/api/search?q=트렌드')).json.length > 0, true);
  } finally { srv.close(); }
});

test('보고 없이 끝난 세션은 검수로, 메시지를 보내면 이어서', async () => {
  const { srv, api, settle, queryFn } = await boot(async (_p, _o, n) => [say(n === 0 ? '물어볼게요' : '알겠어요')]);
  try {
    const { json: { id } } = await api('POST', '/api/tasks', { dept: '비서실', title: '일정', instruction: '내일 일정 정리' });
    await settle();
    let task = (await api('GET', `/api/tasks/${id}`)).json;
    assert.equal(task.status, '검수');
    assert.equal(task.runtime.lastText, '물어볼게요');

    await api('POST', `/api/tasks/${id}/messages`, { text: '오전만' });
    await settle();
    assert.equal(queryFn.calls[1].prompt, '오전만');
    assert.equal(queryFn.calls[1].options.resume, 'sess-0');
    task = (await api('GET', `/api/tasks/${id}`)).json;
    assert.match(task.body, /사용자: 오전만/);
  } finally { srv.close(); }
});

test('권한 요청은 결정 카드가 되고, 답하면 세션이 계속된다', async () => {
  let permission;
  const { srv, api, settle } = await boot(async (_p, options) => {
    permission = options.canUseTool('Bash', { command: 'dir' }, { signal: new AbortController().signal });
    return [];
  });
  try {
    const { json: { id } } = await api('POST', '/api/tasks', { dept: '비서실', instruction: '폴더 보기' });
    await new Promise((r) => setTimeout(r, 50));
    const state = (await api('GET', '/api/state')).json;
    const dec = state.pending[0];
    assert.equal(dec.kind, '권한');
    assert.deepEqual(dec.options, ['허용', '거부']);
    assert.equal(state.tasks[0].status, '결정대기');
    await api('POST', `/api/decisions/${dec.id}`, { choice: 1 });
    assert.equal((await permission).behavior, 'allow');
    await settle();
    assert.notEqual((await api('GET', `/api/tasks/${id}`)).json.status, '결정대기');
  } finally { srv.close(); }
});

test('작업·결정 파일 직접 쓰기는 막는다', async () => {
  let hook;
  const { root, srv, api, settle } = await boot(async (_p, options) => { hook = options.hooks.PreToolUse[0].hooks[0]; return []; });
  try {
    await api('POST', '/api/tasks', { dept: '비서실', instruction: 'x' });
    await settle();
    const denied = await hook({ tool_input: { file_path: path.join(root, '작업', 'W-1.md') } });
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    assert.deepEqual(await hook({ tool_input: { file_path: path.join(root, '보고서', 'R-1.md') } }), {});
  } finally { srv.close(); }
});

test('잘못된 요청', async () => {
  const { srv, api } = await boot(async () => []);
  try {
    assert.equal((await api('POST', '/api/tasks', { dept: '없는부서', instruction: 'x' })).status, 400);
    assert.equal((await api('POST', '/api/tasks', { dept: '비서실', instruction: ' ' })).status, 400);
    assert.equal((await api('GET', '/api/tasks/W-000000-001')).status, 404);
    assert.equal((await api('GET', '/api/nope')).status, 404);
  } finally { srv.close(); }
});

test('문서 보기·고치기: 형식을 깨면 되돌린다', async () => {
  const { srv, api, settle } = await boot(async () => []);
  try {
    const { json: { id } } = await api('POST', '/api/tasks', { dept: '비서실', instruction: '문서 시험' });
    await settle();
    const doc = (await api('GET', `/api/docs/${id}`)).json;
    assert.equal(doc.rel, `작업/${id}.md`);

    const edited = doc.raw.replace('\n문서 시험\n', '\n문서 시험 (고침)\n');
    assert.equal((await api('PUT', `/api/docs/${id}`, { raw: edited })).status, 200);
    assert.match((await api('GET', `/api/docs/${id}`)).json.body, /\(고침\)/);

    const broken = doc.raw.replace(/^status: .*$/m, 'status: 아무거나');
    const r = await api('PUT', `/api/docs/${id}`, { raw: broken });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /status "아무거나"/);
    assert.match((await api('GET', `/api/docs/${id}`)).json.raw, /\(고침\)/);

    assert.equal((await api('GET', '/api/docs/없는문서')).status, 404);
    const state = (await api('GET', '/api/state')).json;
    assert.ok(Array.isArray(state.reports) && Array.isArray(state.journals));
  } finally { srv.close(); }
});

test('예약: 반복 작업은 때가 되면 하위 작업을 만들어 돌리고, 한 번 예약은 그 작업을 시작한다', async () => {
  const root = tempVault();
  const queryFn = fakeQuery(async () => [say('끝')]);
  let clock = new Date();
  const srv = createServer({ root, port: 0, runner: { queryFn }, scheduler: { now: () => clock }, externalDir: path.join(root, '.external') });
  const port = await srv.listen();
  const api = async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  const settle = async () => { for (let i = 0; i < 100 && !srv.runner.idle(); i++) await new Promise((r) => setTimeout(r, 10)); };
  try {
    assert.equal((await api('POST', '/api/tasks', { dept: '리서치부', instruction: 'x', schedule: '내일 아침' })).status, 400);

    const { json: { id: routine } } = await api('POST', '/api/tasks', { dept: '리서치부', title: '아침 트렌드', instruction: '트렌드 정리', schedule: '매일 07:30' });
    const { json: { id: once } } = await api('POST', '/api/tasks', { dept: '비서실', instruction: '한 번만', schedule: '2099-01-01T09:00' });
    let state = (await api('GET', '/api/state')).json;
    const r0 = state.tasks.find((t) => t.id === routine);
    assert.equal(r0.status, '대기예약');
    assert.equal(r0.repeat, true);
    assert.match(r0.next, /T07:30$/);
    assert.equal(queryFn.calls.length, 0);

    // 다음 날 07:31 → 반복 실행
    clock = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + 1, 7, 31);
    const started = await srv.scheduler.tick();
    assert.equal(started.length, 1);
    await settle();
    assert.equal(queryFn.calls[0].prompt, '트렌드 정리');
    state = (await api('GET', '/api/state')).json;
    const child = state.tasks.find((t) => t.id === started[0]);
    assert.equal(child.parent, `[[${routine}]]`);
    assert.match(child.title, /^아침 트렌드 \d+\/\d+$/);
    assert.equal(state.tasks.find((t) => t.id === routine).status, '대기예약');
    assert.deepEqual(await srv.scheduler.tick(), []); // 같은 날 두 번은 안 돈다

    // 지금 실행 버튼: 한 번 예약은 그 작업이 시작된다
    assert.equal((await api('POST', `/api/tasks/${once}/run`, {})).json.started, once);
    await settle();
    assert.notEqual((await api('GET', `/api/tasks/${once}`)).json.status, '대기예약');

    assert.deepEqual(checkVault(loadVault(root)).errors, []);
  } finally { srv.close(); }
});

test('부서 하위 항목: 만들기 → 그 항목으로 일 맡기기 → 트리·그래프·검사', async () => {
  const { root, srv, api, settle } = await boot(async () => [say('끝')]);
  try {
    assert.equal((await api('POST', '/api/units', { dept: '리서치부', name: '경쟁사', summary: '경쟁 도구 조사' })).json.id, '하위:리서치부/경쟁사');
    assert.equal((await api('POST', '/api/units', { dept: '리서치부', name: '경쟁사' })).status, 409);
    assert.equal((await api('POST', '/api/units', { dept: '리서치부', name: 'a/b' })).status, 400);
    assert.equal((await api('POST', '/api/tasks', { dept: '리서치부', unit: '없는항목', instruction: 'x' })).status, 400);

    const { json: { id } } = await api('POST', '/api/tasks', { dept: '리서치부', unit: '경쟁사', instruction: '경쟁 도구 3개 비교' });
    await settle();
    const state = (await api('GET', '/api/state')).json;
    assert.equal(state.units.find((u) => u.name === '경쟁사').dept, '리서치부');
    assert.equal(state.tasks.find((t) => t.id === id).unit, '경쟁사');
    const graph = (await api('GET', '/api/graph')).json;
    assert.equal(graph.nodes.find((n) => n.id === id).parent, '하위:리서치부/경쟁사');
    assert.equal(graph.nodes.find((n) => n.id === '하위:리서치부/경쟁사').parent, '부서:리서치부');
    assert.equal((await api('GET', `/api/docs/${encodeURIComponent('하위:리서치부/경쟁사')}`)).json.data.summary, '경쟁 도구 조사');
    assert.equal((await api('GET', `/api/docs/${encodeURIComponent('부서:리서치부')}`)).json.data.type, '부서');
    assert.deepEqual(checkVault(loadVault(root)).errors, []);
  } finally { srv.close(); }
});

test('타임라인: 진행 로그를 시간순 사건으로, 종류도 나눈다', async () => {
  const { srv, api, settle } = await boot(async (_p, options, n) => {
    if (n === 0) {
      await callTool(options, 'log_progress', { text: '자료 모으는 중' });
      await callTool(options, 'request_decision', { title: '범위', options: ['a', 'b'], background: 'x' });
    }
    return [say('끝')];
  });
  try {
    const { json: { id } } = await api('POST', '/api/tasks', { dept: '리서치부', instruction: '타임라인 시험' });
    await settle();
    const ev = (await api('GET', '/api/timeline')).json;
    const mine = ev.filter((e) => e.task === id);
    assert.deepEqual(mine.map((e) => e.kind).reverse(), ['create', 'log', 'decision']);
    assert.equal((await api('GET', `/api/timeline?dept=${encodeURIComponent('비서실')}`)).json.length, 0);
  } finally { srv.close(); }
});

test('기억에 질문하기: 읽기 도구만 쓰고, 근거는 지도에 있는 점만 돌려준다', async () => {
  const { srv, api, queryFn } = await boot(async (prompt, options) => {
    if (options.allowedTools?.includes('Read')) return [say('리서치부는 조사를 맡는다.\n근거: [[리서치부]] [[없는문서]]')];
    return [say('끝')];
  });
  try {
    assert.equal((await api('POST', '/api/ask', { q: '  ' })).status, 400);
    const r = await api('POST', '/api/ask', { q: '리서치부는 뭐 해?' });
    assert.equal(r.status, 200);
    assert.match(r.json.answer, /조사/);
    assert.deepEqual(r.json.sources.map((s) => s.id), ['부서:리서치부']);
    assert.match(r.json.answer, /\[\[부서:리서치부\|리서치부\]\]/);   // 줄여 쓴 링크는 점 ID로
    assert.match(r.json.answer, /\[\[없는문서\]\]/);
    const o = queryFn.calls.at(-1).options;
    assert.deepEqual(o.allowedTools, ['Read', 'Grep', 'Glob']);
    assert.equal(o.disallowedTools.includes('Write') && o.disallowedTools.includes('Bash'), true);
    assert.deepEqual(await o.canUseTool('Write', {}, {}), { behavior: 'deny', message: '기억 찾기는 읽기만 한다' });
  } finally { srv.close(); }
});

test('기억 쌓기: 지시·이어서·결정·완료·다시 열기가 주인 말·검수 판정 파일에 남는다', async () => {
  const { root, srv, api, settle } = await boot(async (_p, options, n) => {
    if (n === 0) {
      await callTool(options, 'request_decision', { title: '말투', options: ['짧게', '길게'], background: 'x' });
      return [say('골라 주세요')];
    }
    await callTool(options, 'submit_result', { summary: '끝' });
    return [say('끝')];
  });
  try {
    const { json: { id } } = await api('POST', '/api/tasks', { dept: '리서치부', instruction: '기억 시험 일' });
    await settle();
    const dec = (await api('GET', '/api/state')).json.pending[0];
    await api('POST', `/api/decisions/${dec.id}`, { choice: 1, note: '빨리' });
    await settle();
    await api('POST', `/api/tasks/${id}/messages`, { text: '하나 더 해줘' });
    await settle();
    await api('POST', `/api/tasks/${id}/status`, { status: '완료' });
    await api('POST', `/api/tasks/${id}/status`, { status: '검수', note: '표가 빠졌음' });

    const dir = path.join(root, '기억');
    const files = fs.readdirSync(dir).sort();
    assert.equal(files.length, 2);
    const owner = fs.readFileSync(path.join(dir, files.find((f) => f.startsWith('주인말-'))), 'utf8');
    assert.match(owner, /^---\ntype: 주인말\ndate: \d{4}-\d{2}-\d{2}\n---/);
    const has = (text, part) => assert.ok(text.includes(part), `없음: ${part}\n${text}`);
    has(owner, `**지시** [[${id}]] 리서치부 — 기억 시험 일`);
    has(owner, `**결정** [[${dec.id}]] 말투 → 1번 “짧게” · 메모: 빨리 ([[${id}]])`);
    has(owner, `**이어서** [[${id}]] — 하나 더 해줘`);
    const review = fs.readFileSync(path.join(dir, files.find((f) => f.startsWith('검수-'))), 'utf8');
    has(review, `**완료** [[${id}]] `);
    has(review, '(검수 → 확인)');
    has(review, '(완료 → 검수) — 표가 빠졌음');
    // 형식 검사 통과, 지도에 점으로 뜬다
    assert.deepEqual(checkVault(loadVault(root)).errors, []);
    const g = (await api('GET', '/api/graph')).json;
    assert.equal(g.nodes.filter((x) => x.type === '주인말' || x.type === '검수판정').length, 2);
    // 기억 탭: 날짜별 항목 + 가리킨 작업의 이름·상태
    const mem = (await api('GET', '/api/memory')).json;
    assert.equal(mem.days.length, 1);
    const kinds = mem.days[0].entries.map((e) => e.kind);
    for (const k of ['지시', '결정', '이어서', '완료', '다시 열기']) assert.ok(kinds.includes(k), `없음: ${k}`);
    assert.equal(mem.days[0].entries.find((e) => e.kind === '지시').task, id);
    assert.equal(mem.refs[id].title, '기억 시험 일');
    assert.equal(mem.refs[id].status, '검수');
    const one = (await api('GET', `/api/memory?name=${encodeURIComponent(files.find((f) => f.startsWith('검수-')).slice(0, -3))}`)).json;
    assert.deepEqual(one.days[0].entries.map((e) => e.source), ['검수판정', '검수판정']);
  } finally { srv.close(); }
});

test('기억 카드: 그날 기록 → 후보 결재 → 승인한 카드만 생기고, 다음 세션 지시문에 붙는다', async () => {
  const candidates = JSON.stringify([
    { rule: '보고서는 결론 세 줄을 맨 위에 둔다', dept: '리서치부', unit: null, sources: ['W-000000-000'], why: '메모에서' },
    { rule: '모든 부서: 파일은 휴지통으로만', dept: null, unit: null, sources: [], why: '검수에서' },
    { rule: '버릴 후보', dept: '없는부서', unit: null, sources: [], why: '' },
  ]);
  const { srv, api, settle, queryFn } = await boot(async (prompt, options) => {
    if (options.allowedTools?.includes('Read')) return [say('```json\n' + candidates + '\n```')];
    return [say('끝')];
  });
  try {
    // 기록이 없는 날은 뽑지 않는다
    assert.equal((await api('POST', '/api/memory/propose', { date: '2020-01-01' })).status, 404);
    await api('POST', '/api/tasks', { dept: '리서치부', instruction: '오늘 첫 지시', start: false });
    const p = (await api('POST', '/api/memory/propose', {})).json;
    assert.equal(p.count, 3);
    let state = (await api('GET', '/api/state')).json;
    const decs = state.pending.filter((d) => d.kind === '기억');
    assert.equal(decs.length, 3);
    assert.equal(state.tasks.find((t) => t.id === p.task).status, '결정대기');
    // 그냥 기억 / 고쳐서 기억(메모 없으면 거절) / 버림
    assert.equal((await api('POST', `/api/decisions/${decs[0].id}`, { choice: 1 })).status, 200);
    assert.equal((await api('POST', `/api/decisions/${decs[1].id}`, { choice: 2 })).status, 400);
    assert.equal((await api('POST', `/api/decisions/${decs[1].id}`, { choice: 2, note: '파일은 지우지 말고 휴지통으로 보낸다' })).status, 200);
    assert.equal((await api('POST', `/api/decisions/${decs[2].id}`, { choice: 3 })).status, 200);
    const cards = (await api('GET', '/api/memory/cards')).json;
    assert.deepEqual(cards.map((c) => [c.rule, c.dept]).sort(), [['보고서는 결론 세 줄을 맨 위에 둔다', '리서치부'], ['파일은 지우지 말고 휴지통으로 보낸다', null]]);
    state = (await api('GET', '/api/state')).json;
    assert.equal(state.tasks.find((t) => t.id === p.task).status, '완료');
    // 카드 버리기·되살리기
    const k = cards.find((c) => c.dept === null);
    assert.equal((await api('POST', `/api/memory/cards/${k.id}`, { status: '버림' })).json.status, '버림');
    assert.equal((await api('POST', `/api/memory/cards/${k.id}`, { status: '사용' })).json.status, '사용');
    // 다음 세션 지시문에 붙는다 (부서가 맞는 카드 + 모두 대상 카드)
    await api('POST', '/api/tasks', { dept: '리서치부', instruction: '카드 확인용' });
    await settle();
    const sys = queryFn.calls.at(-1).options.systemPrompt.append;
    assert.match(sys, /## 기억 카드/);
    assert.ok(sys.includes('보고서는 결론 세 줄을 맨 위에 둔다') && sys.includes('파일은 지우지 말고 휴지통으로 보낸다'));
    await api('POST', '/api/tasks', { dept: '비서실', instruction: '다른 부서' });
    await settle();
    const sys2 = queryFn.calls.at(-1).options.systemPrompt.append;
    assert.ok(!sys2.includes('결론 세 줄') && sys2.includes('휴지통으로 보낸다'));
    assert.deepEqual(checkVault(loadVault(srv.store.root)).errors, []);
  } finally { srv.close(); }
});

test('비서실장: save_unit·save_process로 다른 부서의 하위 항목·공정을 만든다, 다른 부서는 자기 것만, 형식 오류는 되돌린다', async () => {
  const { root, srv, api, settle } = await boot(async (prompt, options, n) => {
    const out = [];
    if (/비서실 일/.test(prompt)) {
      out.push((await callTool(options, 'save_unit', { dept: '리서치부', name: '자막 조사', summary: '자막 도구 조사', match: ['자막조사'], commands: { 현황: 'Get-Date' }, body: '# 자막 조사\n\n하는 일' })).content[0].text);
      out.push((await callTool(options, 'save_unit', { dept: '리서치부', name: '자막 조사', summary: '바꾼 설명' })).content[0].text);
      out.push((await callTool(options, 'save_process', { dept: '리서치부', unit: '자막 조사', name: '자막-조사', title: '자막 조사 공정', stages: ['찾기', '정리'], steps: { 찾기: { do: '찾는다', gate: true } } })).content[0].text);
      // 형식 오류: stages에 없는 단계 정의 → 저장하지 않음
      out.push((await callTool(options, 'save_process', { dept: '리서치부', name: '잘못', stages: ['a'], steps: { b: { do: 'x' } } })).content[0].text);
    } else {
      out.push((await callTool(options, 'save_unit', { dept: '비서실', name: '남의 것' })).content[0].text);
    }
    await callTool(options, 'submit_result', { summary: out.join(' | ') });
    return [say('끝'), used('submit_result')];
  });
  try {
    await api('POST', '/api/tasks', { dept: '비서실', instruction: '비서실 일: 리서치부에 자막 조사 항목' });
    await settle();
    await api('POST', '/api/tasks', { dept: '리서치부', instruction: '리서치 일' });
    await settle();
    const u = srv.store.units('리서치부').find((x) => x.name === '자막 조사');
    assert.equal(u.summary, '바꾼 설명');           // 두 번째 저장은 준 칸만 바꿈
    assert.deepEqual(u.match, ['자막조사']);         // 안 준 칸은 그대로
    assert.deepEqual(u.commands, { 현황: 'Get-Date' });
    assert.match(u.rules, /하는 일/);
    const p = srv.store.processes().find((x) => x.id === '자막-조사');
    assert.deepEqual([p.unit, p.status, p.stages], ['자막 조사', '정지', ['찾기', '정리']]);
    assert.equal(fs.existsSync(path.join(root, '부서/리서치부/공정/잘못.md')), false);
    const tasks = srv.store.listTasks();
    const t1 = srv.store.readTask(tasks.find((t) => t.dept === '비서실').id).body;
    assert.match(t1, /형식 오류로 되돌림/);
    const t2 = srv.store.readTask(tasks.find((t) => t.dept === '리서치부').id).body;
    assert.match(t2, /자기 부서 하위 항목만/);
    assert.equal(srv.store.units('비서실').length, 0);

    // 하위 항목 명령: 문서에 적힌 것만 돈다
    const r = (await api('POST', '/api/units/command', { unit: '하위:리서치부/자막 조사', name: '현황' })).json;
    assert.equal(r.code, 0);
    assert.equal((await api('POST', '/api/units/command', { unit: '하위:리서치부/자막 조사', name: '없는 것' })).status, 404);
    assert.deepEqual(checkVault(loadVault(root)).errors, []);
  } finally { srv.close(); }
});

test('작업 이름 바꾸기: 화면 API(사용자)와 세션 도구 rename_task(자기 작업만)', async () => {
  const { root, srv, api, settle, queryFn } = await boot(async (_prompt, options) => {
    const out = [];
    out.push((await callTool(options, 'rename_task', { title: '  세션이   바꾼 이름 ', why: '주인말 요청' })).content[0].text);
    out.push((await callTool(options, 'rename_task', { title: '세션이 바꾼 이름' })).content[0].text);
    out.push((await callTool(options, 'rename_task', { title: ' ' })).content[0].text);
    await callTool(options, 'submit_result', { summary: out.join(' | ') });
    return [say('끝'), used('submit_result')];
  });
  try {
    const { json: { id } } = await api('POST', '/api/tasks', { dept: '리서치부', title: '옛 이름', instruction: '조사' });
    await settle();
    assert.equal(queryFn.calls[0].options.allowedTools.includes('mcp__brain__rename_task'), true);
    let task = (await api('GET', `/api/tasks/${id}`)).json;
    assert.equal(task.title, '세션이 바꾼 이름');      // 공백은 한 칸으로 다듬음
    assert.match(task.body, /세션이 이름 변경 → 세션이 바꾼 이름 \(전: 옛 이름\)/);
    assert.match(task.body, /이름 변경 까닭: 주인말 요청/);
    assert.match(task.body, /이미 "세션이 바꾼 이름"이다/);
    assert.match(task.body, /못 바꿈: title이 비었음/);
    const status = task.status;

    // 화면에서 사용자가 바꿈 → title·updated·진행 로그·주인말 기억, 상태는 그대로
    const r = await api('POST', `/api/tasks/${id}/title`, { title: 'Voxyn 주간 활동/마케팅 리서치' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.before, r.json.title, r.json.changed], ['세션이 바꾼 이름', 'Voxyn 주간 활동/마케팅 리서치', true]);
    task = (await api('GET', `/api/tasks/${id}`)).json;
    assert.equal(task.title, 'Voxyn 주간 활동/마케팅 리서치');
    assert.equal(task.status, status);
    assert.match(task.body, /사용자가 이름 변경 → Voxyn 주간 활동\/마케팅 리서치 \(전: 세션이 바꾼 이름\)/);
    const mem = fs.readdirSync(path.join(root, '기억')).find((f) => f.startsWith('주인말-'));
    assert.equal(fs.readFileSync(path.join(root, '기억', mem), 'utf8').includes(`**이름 변경** [[${id}]] 세션이 바꾼 이름 → Voxyn 주간 활동/마케팅 리서치`), true);

    // 같은 이름은 바뀐 것 없음, 빈 이름·너무 긴 이름·없는 작업은 거절
    assert.equal((await api('POST', `/api/tasks/${id}/title`, { title: 'Voxyn 주간 활동/마케팅 리서치' })).json.changed, false);
    assert.equal((await api('POST', `/api/tasks/${id}/title`, { title: '  ' })).status, 400);
    assert.equal((await api('POST', `/api/tasks/${id}/title`, { title: 'ㄱ'.repeat(61) })).status, 400);
    assert.equal((await api('POST', '/api/tasks/W-000000-001/title', { title: 'x' })).status, 404);
    assert.equal((await api('GET', `/api/tasks/${id}`)).json.title, 'Voxyn 주간 활동/마케팅 리서치');
    assert.deepEqual(checkVault(loadVault(root)).errors, []);
  } finally { srv.close(); }
});

test('이름: 지시 첫머리로 만든 작업은 첫 세션에 "짧은 이름 붙이기" 안내, 이름을 준 작업은 안내 없음', async () => {
  const { srv, api, settle, queryFn } = await boot(async () => [say('끝')]);
  try {
    await api('POST', '/api/tasks', { dept: '리서치부', instruction: '내 페르소나 가수 Voxyn의 주간 활동/마케팅 리서치를 진행한다. 자세히.' });
    await settle();
    await api('POST', '/api/tasks', { dept: '리서치부', title: 'Voxyn 리서치', instruction: '내 페르소나 가수 Voxyn의 주간 활동을 조사한다.' });
    await settle();
    assert.match(queryFn.calls[0].options.systemPrompt.append, /지시 첫머리를 자른 임시 이름이다/);
    assert.doesNotMatch(queryFn.calls[1].options.systemPrompt.append, /임시 이름이다/);
  } finally { srv.close(); }
});
