import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createWorklog, isTracked, sessionOf } from '../lib/worklog.mjs';

// 경로는 / 로 쓴다 (activity의 norm이 \ 로 맞춘다)
function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
  const dept = (name, workdir) => {
    fs.mkdirSync(path.join(root, '부서', name, '하위'), { recursive: true });
    fs.writeFileSync(path.join(root, '부서', name, '규칙.md'), `---\ntype: 부서\nname: ${name}\nworkdir: ${workdir}\n---\n# ${name}\n`);
  };
  dept('비정규직', 'C:/Work');
  dept('기획실', 'C:/Work/SYNAPSE BRAIN/부서작업/기획실');
  fs.writeFileSync(path.join(root, '부서', '기획실', '하위', '신작게임.md'),
    "---\ntype: 하위\nname: 신작게임\ndept: 기획실\nworkdir: C:/Work/게임A\nmatch:\n  - 'C:/Work/게임A'\n---\n# 신작게임\n");
  fs.mkdirSync(path.join(root, '작업'));
  return root;
}

test('세션 하나 = 작업 하나, 폴더로 부서 배정, 턴 끝은 검수', async () => {
  const store = createStore(vault());
  const wl = createWorklog({ store });
  const s = { cwd: 'C:/Work/게임A', paths: [] };
  const id = await wl.track({ session_id: 'abc', hook_event_name: 'UserPromptSubmit', prompt: '위키 게시해줘' }, s);
  let t = store.readTask(id).data;
  assert.equal(t.dept, '기획실');
  assert.equal(t.unit, '신작게임');
  assert.equal(t.status, '실행중');
  assert.ok(isTracked(t));
  assert.equal(sessionOf(t), 'abc');
  await wl.track({ session_id: 'abc', hook_event_name: 'Stop', last_assistant_message: '게시했습니다' }, s);
  t = store.readTask(id);
  assert.equal(t.data.status, '검수');
  assert.match(t.body, /게시했습니다/);
  assert.equal(await wl.track({ session_id: 'abc', hook_event_name: 'UserPromptSubmit', prompt: '하나 더' }, s), id);
  assert.equal(store.readTask(id).data.status, '실행중');
  assert.equal(store.listTasks().length, 1);
});

test('모르는 폴더는 비정규직, 더 좁은 경로를 만지면 다시 배정', async () => {
  const store = createStore(vault());
  const wl = createWorklog({ store });
  const s = { cwd: 'C:/Users/me/scratch', paths: [] };
  const id = await wl.track({ session_id: 'x1', hook_event_name: 'UserPromptSubmit', prompt: '이거 봐줘' }, s);
  assert.equal(store.readTask(id).data.dept, '비정규직');
  s.paths.push('C:/Work/게임A/3_아웃풋/a.md');
  await wl.track({ session_id: 'x1', hook_event_name: 'Stop' }, s);
  const t = store.readTask(id).data;
  assert.equal(t.dept, '기획실');
  assert.equal(t.unit, '신작게임');
});

test('두뇌가 띄운 세션과 키 같은 덩어리는 기록하지 않는다', async () => {
  const store = createStore(vault());
  const wl = createWorklog({ store });
  assert.equal(await wl.track({ session_id: 'b', hook_event_name: 'UserPromptSubmit', prompt: 'x' }, null, { brainTask: 'W-1' }), null);
  assert.equal(await wl.track({ session_id: 'b', hook_event_name: 'UserPromptSubmit', prompt: 'x' }, { cwd: 'C:/Work' }), null);
  const id = await wl.track({ session_id: 'k', hook_event_name: 'UserPromptSubmit', prompt: 'secret 19c4ef7be102404db6abcdef0123456789 넣어' }, { cwd: 'C:/Work' });
  assert.doesNotMatch(fs.readFileSync(store.readTask(id).file, 'utf8'), /19c4ef7be102404db6/);
  assert.equal(store.listTasks().length, 1);
});

test('세션을 연 폴더가 먼저 — 남의 폴더를 많이 만져도 옮기지 않는다', async () => {
  const root = vault();
  fs.mkdirSync(path.join(root, '부서', '개발실'), { recursive: true });
  fs.writeFileSync(path.join(root, '부서', '개발실', '규칙.md'), "---\ntype: 부서\nname: 개발실\nworkdir: C:/Work\nmatch:\n  - 'C:/Work/SYNAPSE BRAIN'\n---\n# 개발실\n");
  const store = createStore(root);
  const wl = createWorklog({ store });
  const s = { cwd: 'C:/Work/SYNAPSE BRAIN', paths: [] };
  const id = await wl.track({ session_id: 'home', hook_event_name: 'UserPromptSubmit', prompt: '설치해줘' }, s);
  for (let i = 0; i < 20; i++) s.paths.push(`C:/Work/게임A/w${i}.md`);
  await wl.track({ session_id: 'home', hook_event_name: 'Stop' }, s);
  assert.equal(store.readTask(id).data.dept, '개발실');
  assert.equal(store.readTask(id).data.unit, null);
});

test('폴더·경로로 못 가리면 사람 말의 낱말로', async () => {
  const root = vault();
  const f = path.join(root, '부서', '기획실', '하위', '신작게임.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace("  - 'C:/Work/게임A'\n", "  - 'C:/Work/게임A'\n  - '가십하버'\n"));
  const store = createStore(root);
  const wl = createWorklog({ store });
  const id = await wl.track({ session_id: 't', hook_event_name: 'UserPromptSubmit', prompt: '가십하버 이벤트 구조 정리해줘' }, { cwd: 'C:/Users/me/scratch', paths: [] });
  assert.equal(store.readTask(id).data.unit, '신작게임');
});

test('이름은 세션 제목을 따른다 — 사람이 바꾸면 그대로', async () => {
  const store = createStore(vault());
  const wl = createWorklog({ store });
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-')), 's.jsonl');
  fs.writeFileSync(tr, '{"type":"ai-title","aiTitle":"자동 제목"}\n');
  const ev = { session_id: 'n', transcript_path: tr };
  const id = await wl.track({ ...ev, hook_event_name: 'UserPromptSubmit', prompt: '한국어로 해' }, { cwd: 'C:/Work' });
  assert.equal(store.readTask(id).data.title, '자동 제목');
  fs.appendFileSync(tr, '{"type":"custom-title","customTitle":"- 게임A 위키"}\n');
  await wl.track({ ...ev, hook_event_name: 'Stop' }, { cwd: 'C:/Work' });
  assert.equal(store.readTask(id).data.title, '게임A 위키');
  // 사람이 이름을 바꾸면(서버가 자동이름 태그를 뺀다) 더는 따르지 않는다
  const t = store.readTask(id).data;
  await store.patchTask(id, { title: '내 이름', tags: t.tags.filter((x) => x !== '자동이름') });
  fs.appendFileSync(tr, '{"type":"custom-title","customTitle":"다른 제목"}\n');
  await wl.track({ ...ev, hook_event_name: 'Stop' }, { cwd: 'C:/Work' });
  assert.equal(store.readTask(id).data.title, '내 이름');
});

test('같은 세션의 첫 말 두 개가 겹쳐도 작업은 하나', async () => {
  const store = createStore(vault());
  const wl = createWorklog({ store });
  const s = { cwd: 'C:/Work/게임A', paths: [] };
  const [a, b] = await Promise.all([
    wl.track({ session_id: 'dup', hook_event_name: 'UserPromptSubmit', prompt: '하나' }, s),
    wl.track({ session_id: 'dup', hook_event_name: 'UserPromptSubmit', prompt: '둘' }, s),
  ]);
  assert.equal(a, b);
  assert.equal(store.listTasks().length, 1);
});

test('Stop이 막혀(관제 화면 지시로 이어 감) 끝나지 않은 턴은 검수로 넘기지 않는다', async () => {
  const store = createStore(vault());
  const wl = createWorklog({ store });
  const s = { cwd: 'C:/Work/게임A', paths: [] };
  const id = await wl.track({ session_id: 'blk', hook_event_name: 'UserPromptSubmit', prompt: '시작' }, s);
  await wl.track({ session_id: 'blk', hook_event_name: 'Stop', last_assistant_message: '중간' }, s, { blocked: true });
  assert.equal(store.readTask(id).data.status, '실행중');
  await wl.track({ session_id: 'blk', hook_event_name: 'Stop', last_assistant_message: '끝' }, s);
  assert.equal(store.readTask(id).data.status, '검수');
});

test('사람 말 없이 시작된 턴도 도구를 쓰면 검수에서 실행중으로', async () => {
  const store = createStore(vault());
  const wl = createWorklog({ store });
  const s = { cwd: 'C:/Work/게임A', paths: [] };
  const id = await wl.track({ session_id: 'bg', hook_event_name: 'UserPromptSubmit', prompt: '시작' }, s);
  await wl.track({ session_id: 'bg', hook_event_name: 'Stop', last_assistant_message: '끝' }, s);
  assert.equal(store.readTask(id).data.status, '검수');
  await wl.track({ session_id: 'bg', hook_event_name: 'PreToolUse', tool_name: 'Read' }, s);
  assert.equal(store.readTask(id).data.status, '실행중');
});
