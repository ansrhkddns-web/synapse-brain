import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, read } from '../lib/transcript.mjs';
import { toolLabel, now, argOf } from '../lib/ko.mjs';

const L = (o) => JSON.stringify(o);
const lines = [
  L({ type: 'user', uuid: 'u1', timestamp: '2026-11-03T01:00:00Z', message: { content: '<system-reminder>무시</system-reminder>위키 게시해줘' } }),
  L({ type: 'assistant', uuid: 'a1', timestamp: '2026-11-03T01:00:05Z', message: { content: [
    { type: 'text', text: '고치겠습니다.' },
    { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'C:\\w\\a.md' } },
    { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'C:\\w\\b.md' } },
  ] } }),
  L({ type: 'user', timestamp: '2026-11-03T01:00:06Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'tool_result', tool_use_id: 't2', content: '1 줄' }] } }),
  L({ type: 'assistant', uuid: 'a1b', timestamp: '2026-11-03T01:00:07Z', message: { content: [{ type: 'tool_use', id: 't6', name: 'Edit', input: { file_path: 'C:\\w\\실패.md' } }] } }),
  L({ type: 'user', timestamp: '2026-11-03T01:00:08Z', message: { content: [{ type: 'tool_result', tool_use_id: 't6', is_error: true, content: '<tool_use_error>String to replace not found</tool_use_error>' }] } }),
  L({ type: 'assistant', uuid: 'a2', timestamp: '2026-11-03T01:00:09Z', message: { content: [
    { type: 'tool_use', id: 't3', name: 'Artifact', input: { file_path: 'C:\\w\\index.html' } },
    { type: 'tool_use', id: 't4', name: 'Artifact', input: { action: 'quickstart' } },
    { type: 'tool_use', id: 't5', name: 'Bash', input: { command: 'npm test' } },
  ] } }),
  L({ type: 'user', timestamp: '2026-11-03T01:00:10Z', message: { content: [
    { type: 'tool_result', tool_use_id: 't3', content: [{ type: 'text', text: 'Published C:\\w\\index.html at https://claude.ai/artifact/AbC123 (Version 2)' }] },
    { type: 'tool_result', tool_use_id: 't4', content: 'types: https://claude.ai/artifact/TypeXYZ' },
  ] } }),
  L({ type: 'assistant', uuid: 's1', isSidechain: true, message: { content: [{ type: 'text', text: '하위 에이전트 말' }] } }),
  L({ type: 'assistant', uuid: 'a3', timestamp: '2026-11-03T01:00:20Z', message: { content: [{ type: 'text', text: '게시했습니다.' }] } }),
  L({ type: 'user', uuid: 'u2', timestamp: '2026-11-03T01:01:00Z', message: { content: [{ type: 'text', text: '계속' }] } }),
];

test('대화 기록 → 사람 말·답 덩어리·도구 칩(한국어), 하위 에이전트는 뺀다', () => {
  const { messages } = parse(lines.join('\n'));
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(messages[0].text, '위키 게시해줘');
  assert.equal(messages[1].text, '고치겠습니다.\n\n게시했습니다.');
  assert.deepEqual(messages[1].tools.map((t) => t.label), ['파일 고침', '파일 읽음', '파일 고침', '아티팩트 게시', '아티팩트 게시', '명령 실행']);
  assert.equal(messages[1].tools[0].arg, 'a.md');
  assert.ok(!messages.some((m) => /하위 에이전트 말/.test(m.text)));
});

test('증거: 게시 주소(게시 결과만), 성공한 쓰기·읽기만(실패한 Edit은 뺀다), 명령 수, 마지막 답', () => {
  const { evidence: e } = parse(lines.join('\n'));
  assert.deepEqual(e.artifacts.map((a) => a.url), ['https://claude.ai/artifact/AbC123']);
  assert.equal(e.artifacts[0].path, 'C:\\w\\index.html');
  assert.deepEqual(e.files.map((f) => [f.path, f.kind]).sort(), [['C:\\w\\a.md', '쓰기'], ['C:\\w\\b.md', '읽기']]);
  assert.equal(e.commands, 1);
  assert.equal(e.turns, 2);
  assert.equal(e.lastText, '게시했습니다.');
  assert.equal(e.lastUuid, 'a3');
});

test('파일 찾기·캐시: 세션 id로 projects 아래에서 찾는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'));
  fs.mkdirSync(path.join(dir, 'C--x'));
  fs.writeFileSync(path.join(dir, 'C--x', 'sid-1.jsonl'), lines.join('\n'));
  const r = read('sid-1', { projectsDir: dir });
  assert.equal(r.messages.length, 3);
  assert.equal(read('sid-1', { projectsDir: dir }), r);
  assert.equal(read('없는-세션', { projectsDir: dir }), null);
});

test('한국어 사전: 도구·커넥터·모르는 이름', () => {
  assert.equal(toolLabel('Edit'), '파일 고치는 중');
  assert.equal(toolLabel('Bash', 1), '명령 실행');
  assert.equal(toolLabel('mcp__Claude_Browser__computer'), '브라우저 조작 중');
  assert.equal(toolLabel('mcp__brain__log_progress'), '진행 기록 중');
  assert.equal(toolLabel('mcp__foo__bar'), '외부 도구 쓰는 중');
  assert.equal(toolLabel('Zzz'), '도구 실행 중');
  assert.equal(now({ name: 'Read', arg: 'server.mjs' }), '파일 읽는 중 · server.mjs');
  assert.equal(now(null, '쉬는중'), '답 왔음');
  assert.equal(now(null, '입력대기'), '입력 기다리는 중');
  assert.equal(argOf({ url: 'https://claude.ai/x' }), 'claude.ai');
  assert.doesNotMatch(now({ name: 'mcp__ccd_turn__update_plan' }), /[A-Za-z_]{6,}/);
});
