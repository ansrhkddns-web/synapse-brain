import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createCodexLog, parseRollout, isExecCall } from '../lib/codex.mjs';
import { isTracked, sessionOf } from '../lib/worklog.mjs';

function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
  const dept = (name, workdir) => {
    fs.mkdirSync(path.join(root, '부서', name, '하위'), { recursive: true });
    fs.writeFileSync(path.join(root, '부서', name, '규칙.md'), `---\ntype: 부서\nname: ${name}\nworkdir: ${workdir}\n---\n# ${name}\n`);
  };
  dept('비정규직', 'C:/Work');
  dept('기획실', 'C:/Work/SYNAPSE BRAIN/부서작업/기획실');
  fs.writeFileSync(path.join(root, '부서', '기획실', '하위', '신작게임.md'),
    "---\ntype: 하위\nname: 신작게임\ndept: 기획실\nworkdir: C:/Work/게임A\nmatch:\n  - 'C:/Work/게임A'\n  - 신작게임\n---\n# 신작게임\n");
  fs.mkdirSync(path.join(root, '작업'));
  return root;
}

const line = (o) => JSON.stringify(o);
const meta = (id, cwd, originator) => line({ timestamp: '2026-11-19T00:52:16.000Z', type: 'session_meta', payload: { id, cwd, originator } });
const user = (at, text) => line({ timestamp: at, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
const started = (at) => line({ timestamp: at, type: 'event_msg', payload: { type: 'task_started' } });
const done = (at, msg) => line({ timestamp: at, type: 'event_msg', payload: { type: 'task_complete', last_agent_message: msg } });
const call = (at, input) => line({ timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input } });

function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'codexhome-'));
  fs.mkdirSync(path.join(h, 'sessions', '2026', '11', '19'), { recursive: true });
  return h;
}
const write = (h, name, lines) => fs.writeFileSync(path.join(h, 'sessions', '2026', '11', '19', `rollout-${name}.jsonl`), `${lines.join('\n')}\n`);

test('parseRollout: 지침·환경 덩어리는 사람 말이 아니고, 턴 끝과 경로를 읽는다', () => {
  const s = parseRollout([
    meta('s1', 'C:\\Users\\user\\Documents\\Codex\\x', 'codex_work_desktop'),
    user('2026-11-19T00:52:19Z', '# AGENTS.md instructions\n\n<INSTRUCTIONS>…</INSTRUCTIONS>'),
    user('2026-11-19T00:52:19Z', '<environment_context>cwd</environment_context>'),
    started('2026-11-19T00:52:20Z'),
    user('2026-11-19T00:52:20Z', '신작게임 위키 정리해줘'),
    call('2026-11-19T00:52:21Z', "tools.exec_command({cmd:\"dir 'C:\\\\Work\\\\게임A\\\\위키'\"})"),
    done('2026-11-19T00:53:00Z', '정리했습니다'),
  ].join('\n'));
  assert.equal(s.id, 's1');
  assert.deepEqual(s.prompts.map((p) => p.text), ['신작게임 위키 정리해줘']);
  assert.equal(s.ended, true);
  assert.equal(s.last, '정리했습니다');
  assert.equal(s.calls, 1);
  assert.ok(s.paths.some((p) => p.includes('게임A')));
  assert.equal(isExecCall(s), false);
  assert.equal(isExecCall({ originator: 'codex_exec' }), true);
});

test('사람이 연 코덱스 세션 = 작업 하나: 낱말로 배정, 턴 끝은 검수, 새 말은 실행중으로', async () => {
  const root = vault();
  const store = createStore(root);
  const h = home();
  fs.writeFileSync(path.join(h, 'session_index.jsonl'), `${line({ id: 's1', thread_name: '위키 정리' })}\n`);
  const now = () => Date.parse('2026-11-19T01:00:00Z');
  const log = createCodexLog({ store, home: h, stateFile: path.join(root, 'state.json'), now });
  const base = [meta('s1', 'C:\\Users\\user\\Documents\\Codex\\x', 'codex_work_desktop'), started('2026-11-19T00:52:20Z'), user('2026-11-19T00:52:20Z', '신작게임 위키 정리해줘'), done('2026-11-19T00:53:00Z', '정리했습니다')];
  write(h, 's1', base);
  assert.deepEqual(await log.tick(), { sessions: 1, calls: 0, more: false });
  let [t] = store.listTasks();
  assert.equal(t.dept, '기획실');
  assert.equal(t.unit, '신작게임');
  assert.equal(t.title, '위키 정리');
  assert.equal(t.status, '검수');
  assert.ok(isTracked(t));
  assert.equal(sessionOf(t), 's1');
  assert.match(store.readTask(t.id).body, /정리했습니다/);

  // 바뀐 게 없으면 아무것도 안 한다
  assert.deepEqual(await log.tick(), { sessions: 0, calls: 0, more: false });

  // 이어서 말함 (아직 턴 중)
  write(h, 's1', [...base, started('2026-11-19T00:55:00Z'), user('2026-11-19T00:55:00Z', '표도 하나 더')]);
  await log.tick();
  t = store.readTask(t.id);
  assert.equal(t.data.status, '실행중');
  assert.match(t.body, /사람: 표도 하나 더/);
  assert.equal(store.listTasks().length, 1);
});

test('일회성 호출(codex exec)은 날짜·폴더로 묶어 완료 기록 하나에 쌓는다', async () => {
  const root = vault();
  const store = createStore(root);
  const h = home();
  const log = createCodexLog({ store, home: h, stateFile: path.join(root, 'state.json'), now: () => Date.parse('2026-11-19T01:00:00Z') });
  for (const n of [1, 2, 3]) {
    write(h, `e${n}`, [meta(`e${n}`, 'C:\\Work\\게임A\\ui', 'codex_exec'), user(`2026-11-19T00:5${n}:00Z`, `<image name=[Image #1] path="x.png">\n아이콘 ${n} 그려줘`), done(`2026-11-19T00:5${n}:30Z`, 'C:\\out.png')]);
  }
  write(h, 'e9', [meta('e9', 'C:\\Temp\\other', 'codex_exec'), user('2026-11-19T00:59:00Z', '코드 리뷰'), done('2026-11-19T00:59:30Z', '좋음')]);
  assert.deepEqual(await log.tick(), { sessions: 0, calls: 4, more: false });
  const tasks = store.listTasks();
  assert.equal(tasks.length, 2);
  const merge = tasks.find((t) => t.unit === '신작게임');
  assert.equal(merge.status, '완료');
  assert.ok(!isTracked(merge));
  const body = store.readTask(merge.id).body;
  assert.equal((body.match(/호출 \d\d:\d\d/g) ?? []).length, 3);
  assert.match(body, /아이콘 1 그려줘/);
  assert.doesNotMatch(body, /image name/);
});

test('상태 파일이 있으면 다시 켜도 같은 기록을 두 번 쓰지 않는다', async () => {
  const root = vault();
  const store = createStore(root);
  const h = home();
  const stateFile = path.join(root, 'state.json');
  write(h, 'e1', [meta('e1', 'C:\\Work\\게임A', 'codex_exec'), user('2026-11-19T00:51:00Z', '그려줘'), done('2026-11-19T00:51:30Z', 'ok')]);
  await createCodexLog({ store, home: h, stateFile }).tick();
  assert.deepEqual(await createCodexLog({ store, home: h, stateFile }).tick(), { sessions: 0, calls: 0, more: false });
  assert.equal(store.listTasks().length, 1);
});

test('한 번에 perTick개까지만 읽고, 상태를 잃어도 같은 호출·말을 두 번 쓰지 않는다', async () => {
  const root = vault();
  const store = createStore(root);
  const h = home();
  for (const n of [1, 2, 3, 4, 5]) write(h, `e${n}`, [meta(`e${n}`, 'C:\Work\게임A', 'codex_exec'), user(`2026-11-19T00:5${n}:00Z`, `그려줘 ${n}`), done(`2026-11-19T00:5${n}:30Z`, 'ok')]);
  write(h, 's1', [meta('s1', 'C:\Work\게임A', 'codex_work_desktop'), user('2026-11-19T00:50:00Z', '첫 말'), user('2026-11-19T00:50:10Z', '둘째 말'), done('2026-11-19T00:50:30Z', '답')]);
  const log = createCodexLog({ store, home: h, stateFile: path.join(root, 'state.json'), perTick: 2 });
  const r1 = await log.tick();
  assert.equal(r1.more, true);
  let r; do { r = await log.tick(); } while (r.more);
  // 상태 파일을 잃은 새 수집기
  fs.rmSync(path.join(root, 'state.json'));
  do { r = await createCodexLog({ store, home: h, stateFile: path.join(root, 'state.json'), perTick: 100 }).tick(); } while (r.more);
  const tasks = store.listTasks();
  assert.equal(tasks.length, 2);
  const group = store.readTask(tasks.find((t) => t.tags.includes('코덱스호출')).id).body;
  assert.equal((group.match(/호출 \d\d:\d\d/g) ?? []).length, 5);
  const sess = store.readTask(tasks.find((t) => t.tags.includes('cx-s1')).id).body;
  assert.equal((sess.match(/사람: 둘째 말/g) ?? []).length, 1);
});

test('live: 파일 수정 시각이 옛날이어도 기록 안의 마지막 시각이 최근이면 지금 도는 세션', async () => {
  const root = vault();
  const h = home();
  write(h, 's1', [meta('s1', 'C:\Work\게임A', 'codex_work_desktop'), started('2026-11-19T01:20:00Z'), user('2026-11-19T01:20:00Z', '터미널은 어떻게 열어?')]);
  write(h, 'e1', [meta('e1', 'C:\Work\게임A', 'codex_exec'), user('2026-11-19T01:20:00Z', '그려줘')]);
  const old = new Date('2026-11-19T00:00:00Z');
  for (const n of fs.readdirSync(path.join(h, 'sessions', '2026', '11', '19'))) fs.utimesSync(path.join(h, 'sessions', '2026', '11', '19', n), old, old);
  const log = createCodexLog({ store: createStore(root), home: h, now: () => Date.parse('2026-11-19T01:25:00Z') });
  const live = log.live();
  assert.deepEqual(live.map((s) => s.id), ['s1']);
  assert.equal(live[0].ended, false);
});
