// 데스크 API: 바깥 세션(훅) 하나를 처음부터 끝까지 — 세션 조회 · 내 차례 · 대화 · 증거 · 판정 · 멈추기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';

const REAL_VAULT = path.join(import.meta.dirname, '..', '..', 'vault');
const BAD = new Set([6000, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

async function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-'));
  for (const rel of ['CLAUDE.md', '지표/KPI.md', '부서/비서실/규칙.md', '부서/비정규직/규칙.md', '템플릿/작업.md', '템플릿/결정.md']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REAL_VAULT, rel), path.join(root, rel));
  }
  fs.mkdirSync(path.join(root, '작업'), { recursive: true });
  const queryFn = () => (async function* () { yield { type: 'result', subtype: 'success' }; })();
  let srv, port;
  for (let i = 0; i < 5; i++) {
    srv = createServer({ root, port: 0, runner: { queryFn }, externalDir: path.join(root, '.external') });
    port = await srv.listen();
    if (!BAD.has(port)) break;
    srv.close();
  }
  const api = async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  return { root, srv, api };
}
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const L = (o) => JSON.stringify(o);

test('바깥 세션: 세션 조회 → 새 답 → 대화·증거 → 판정(답 맞추기·멱등) → 오늘 끝남', async () => {
  const { root, srv, api } = await boot();
  try {
    const tr = path.join(root, 'sess.jsonl');
    fs.writeFileSync(tr, [
      L({ type: 'user', uuid: 'u1', timestamp: '2026-11-03T01:00:00Z', message: { content: '위키 게시해줘' } }),
      L({ type: 'assistant', uuid: 'a1', timestamp: '2026-11-03T01:00:05Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Artifact', input: { file_path: 'C:\\w\\index.html' } }] } }),
      L({ type: 'user', timestamp: '2026-11-03T01:00:06Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Published C:\\w\\index.html at https://claude.ai/artifact/Zz9 (Version 3)' }] } }),
      L({ type: 'assistant', uuid: 'a2', timestamp: '2026-11-03T01:00:09Z', message: { content: [{ type: 'text', text: '게시했습니다.' }] } }),
    ].join('\n'));
    const ev = (o) => api('POST', '/api/hooks', { session_id: 'out-1', cwd: 'C:\\어딘가', transcript_path: tr, ...o });

    await ev({ hook_event_name: 'UserPromptSubmit', prompt: '위키 게시해줘' });
    await ev({ hook_event_name: 'PreToolUse', tool_name: 'Artifact', tool_input: { file_path: 'C:\\w\\index.html' } });
    await wait();
    let s = (await api('GET', '/api/sessions')).json.find((x) => x.session === 'out-1');
    assert.equal(s.source, '바깥');
    assert.equal(s.run.state, '작업중');
    assert.equal(s.run.now, '아티팩트 게시 중 · index.html');
    assert.ok(s.actions.chips.includes('멈추기'));
    const id = s.id;
    assert.match(id, /^W-/);

    // 멈추기: 바깥 세션은 다음 도구 전에 (예약)
    assert.equal((await api('POST', `/api/tasks/${id}/stop`)).json.how, '예약');
    const pre = (await ev({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })).json;
    assert.equal(pre.out.continue, false);

    // 턴 끝 → 새 답 (행동 필요 수에는 들지 않는다)
    await ev({ hook_event_name: 'Stop', last_assistant_message: '게시했습니다.' });
    await wait();
    const att = (await api('GET', '/api/attention')).json;
    const mine = att.find((x) => x.task === id);
    assert.equal(mine.kind, '새답');
    assert.ok(mine.answer);
    assert.equal((await api('GET', '/api/state')).json.needsMe, 0);
    s = (await api('GET', '/api/sessions')).json.find((x) => x.id === id);
    assert.equal(s.run.state, '쉬는중');
    assert.ok(s.actions.review);

    // 대화·증거는 대화 기록 파일에서
    const msgs = (await api('GET', `/api/tasks/${id}/messages`)).json;
    assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant']);
    assert.equal(msgs[1].toolDetails[0].label, '아티팩트 게시');
    const e = (await api('GET', `/api/tasks/${id}/evidence`)).json;
    assert.deepEqual(e.artifacts.map((a) => a.url), ['https://claude.ai/artifact/Zz9']);
    assert.equal(e.lastAnswer, mine.answer);
    // 증거를 읽은 뒤엔 "지금 게시" 칩이 보인다
    s = (await api('GET', '/api/sessions')).json.find((x) => x.id === id);
    assert.ok(s.actions.chips.includes('지금 게시'));

    // 판정: 옛 답이면 409, 이유 없는 다시는 400, 다시 → 세션에 전달(접수) · 두 번 보내도 한 번
    assert.equal((await api('POST', `/api/tasks/${id}/review`, { verdict: '완료', answer: 'h-old' })).status, 409);
    assert.equal((await api('POST', `/api/tasks/${id}/review`, { verdict: '다시', answer: mine.answer })).status, 400);
    const r1 = await api('POST', `/api/tasks/${id}/review`, { verdict: '다시', answer: mine.answer, note: '8페이지 너무 단조로움' });
    assert.equal(r1.status, 200);
    assert.match(r1.json.when, /쉬는 중/);
    const r2 = await api('POST', `/api/tasks/${id}/review`, { verdict: '다시', answer: mine.answer, note: '8페이지 너무 단조로움' });
    assert.deepEqual(r2.json, r1.json);
    s = (await api('GET', '/api/sessions')).json.find((x) => x.id === id);
    assert.deepEqual(s.delivery.messages.map((m) => [m.text, m.state]), [['[검수] 다시: 8페이지 너무 단조로움', '접수']]);
    assert.equal((await api('GET', `/api/tasks/${id}`)).json.status, '실행중');

    // 다음 턴 → 전달(포함) → 끝 → 확인 완료 → 오늘 끝남 1
    const up = (await ev({ hook_event_name: 'UserPromptSubmit', prompt: '고쳐 줘' })).json;
    assert.match(up.out.hookSpecificOutput.additionalContext, /8페이지 너무 단조로움/);
    await ev({ hook_event_name: 'Stop', last_assistant_message: '고쳤습니다.' });
    await wait();
    const ans = (await api('GET', '/api/attention')).json.find((x) => x.task === id).answer;
    assert.notEqual(ans, mine.answer);
    assert.equal((await api('POST', `/api/tasks/${id}/review`, { verdict: '완료', answer: ans })).json.status, '완료');
    assert.equal((await api('GET', '/api/state')).json.doneToday, 1);
    // 판정한 뒤 늦게 온 턴 끝은 상태를 되돌리지 않는다
    await ev({ hook_event_name: 'Stop', last_assistant_message: '늦은 답' });
    await wait();
    assert.equal((await api('GET', `/api/tasks/${id}`)).json.status, '완료');
  } finally { srv.close(); }
});

test('작업 기록 전 바깥 세션(cc:)도 돌아가는 중에 보이고, 대화는 읽기 전용으로 열린다', async () => {
  const { root, srv, api } = await boot();
  try {
    const tr = path.join(root, 'pre.jsonl');
    fs.writeFileSync(tr, L({ type: 'user', uuid: 'u', timestamp: '2026-11-03T01:00:00Z', message: { content: '안녕' } }));
    await api('POST', '/api/hooks', { session_id: 'pre-1', hook_event_name: 'PreToolUse', cwd: 'C:\\x', transcript_path: tr, tool_name: 'Grep', tool_input: { pattern: 'foo' } });
    await wait();
    const s = (await api('GET', '/api/sessions')).json.find((x) => x.session === 'pre-1');
    assert.equal(s.id, 'cc:pre-1');
    assert.equal(s.task, null);
    assert.equal(s.run.now, '내용 찾는 중 · foo');
    assert.equal((await api('GET', '/api/tasks/cc:pre-1/messages')).json.length, 1);
  } finally { srv.close(); }
});
