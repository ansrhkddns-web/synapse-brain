import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHooks } from '../lib/hooks.mjs';

const store = {
  root: 'V:\\vault',
  depts: () => [{ name: '영상편집부', workdir: 'D:\\AI Project\\영상편집' }],
  units: () => [{ dept: '영상편집부', name: '영화리뷰' }],
  processes: () => [{ id: '영화리뷰-제작', dept: '영상편집부', unit: '영화리뷰', workdir: 'D:\\AI Project\\영상편집\\3. Work\\cache\\영화리뷰' }],
};

test('훅: 상태·문서 알림·멈추기·지시 잇기', () => {
  let t = 1_000_000;
  const h = createHooks({ store, now: () => t });
  const id = 'abc';
  const cwd = 'D:\\AI Project\\영상편집\\3. Work\\cache\\영화리뷰\\carnival';

  // 시작: 그 폴더의 부서·하위·공정 문서를 알려 준다
  const start = h.handle({ session_id: id, hook_event_name: 'SessionStart', cwd, source: 'startup' });
  assert.match(start.hookSpecificOutput.additionalContext, /영상편집부 \/ 영화리뷰 \/ 공정 영화리뷰-제작/);
  assert.match(start.hookSpecificOutput.additionalContext, /공정\\영화리뷰-제작\.md/);
  assert.equal(h.get(id).state, '쉬는중');

  // 일하는 중 → 지시를 넣으면 Stop에서 턴을 끝내지 않고 그 지시로 이어 간다
  assert.equal(h.handle({ session_id: id, hook_event_name: 'UserPromptSubmit', prompt: '대본 써 줘' }), null);
  assert.equal(h.handle({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `${cwd}\\대본.md` } }), null);
  assert.equal(h.get(id).state, '작업중');
  assert.equal(h.control(id, { message: '나레이션도 이어서' }).ok, true);
  const stop = h.handle({ session_id: id, hook_event_name: 'Stop' });
  assert.equal(stop.decision, 'block');
  assert.match(stop.reason, /나레이션도 이어서/);
  assert.equal(h.get(id).state, '작업중');
  // 한 번 전한 지시는 다시 보내지 않는다
  assert.equal(h.handle({ session_id: id, hook_event_name: 'Stop' }), null);
  assert.equal(h.get(id).state, '쉬는중');

  // 쉬는 중에 넣은 지시는 다음 사람 말에 붙는다
  h.control(id, { message: '썸네일 먼저' });
  const up = h.handle({ session_id: id, hook_event_name: 'UserPromptSubmit', prompt: '계속' });
  assert.match(up.hookSpecificOutput.additionalContext, /썸네일 먼저/);

  // 멈추기: 다음 도구 전에 continue:false
  h.control(id, { stop: true });
  const pre = h.handle({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ffmpeg -i a.mp4' } });
  assert.equal(pre.continue, false);
  assert.equal(pre.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(h.handle({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }), null);

  // 권한 알림 → 입력 대기, 끝 → 끝남, 끝난 세션엔 명령 못 함
  h.handle({ session_id: id, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.equal(h.get(id).state, '입력대기');
  h.handle({ session_id: id, hook_event_name: 'SessionEnd', reason: 'exit' });
  assert.equal(h.get(id).state, '끝남');
  assert.equal(h.control(id, { stop: true }).ok, false);
  assert.equal(h.control('없는세션', { stop: true }).ok, false);
});

test('훅: 지시 전달 상태 접수 → 포함 → 관측, 응답 못 받으면 3분 뒤 다시 싣기, 하나만 취소', () => {
  let t = 2_000_000;
  const h = createHooks({ store, now: () => t });
  const id = 'dlv';
  h.handle({ session_id: id, hook_event_name: 'UserPromptSubmit', prompt: '시작' });
  const r = h.control(id, { message: '계속 진행해' });
  assert.equal(r.message.state, '접수');
  assert.equal(r.when, '이번 턴이 끝나기 전에 전달');
  // 턴 끝 → 훅 응답에 실림(포함), 아직 목록에 남는다
  t += 1000;
  assert.equal(h.handle({ session_id: id, hook_event_name: 'Stop' }).decision, 'block');
  assert.equal(h.get(id).delivery.messages[0].state, '포함');
  // 다음 사건이 오면 관측 → 목록에서 빠지고 최근 전달에 남는다
  t += 1000;
  h.handle({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'a.md' } });
  assert.equal(h.get(id).delivery.messages.length, 0);
  assert.equal(h.get(id).delivery.recent.at(-1).state, '관측');
  assert.equal(h.get(id).now, '파일 읽는 중 · a.md');

  // 포함했는데 3분 넘게 아무 사건이 없으면(훅이 응답을 못 받음) 접수로 돌아가 다시 실린다
  h.control(id, { message: '한국어로' });
  t += 1000;
  h.handle({ session_id: id, hook_event_name: 'Stop' });
  t += 4 * 60_000;
  assert.equal(h.get(id).delivery.messages[0].state, '접수');
  const again = h.handle({ session_id: id, hook_event_name: 'Stop' });
  assert.match(again.reason, /\(다시 보냄\) 한국어로/);

  // 쉬는 세션 안내, 하나만 취소, 턴 끝 답 열쇠
  t += 1000;
  h.handle({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
  h.handle({ session_id: id, hook_event_name: 'Stop', last_assistant_message: '끝났습니다' });
  assert.equal(h.get(id).lastText, '끝났습니다');
  assert.ok(h.get(id).lastAnswer);
  const a = h.control(id, { message: '하나' }).message;
  h.control(id, { message: '둘' });
  assert.match(h.get(id).delivery.when, /쉬는 중/);
  h.cancel(id, a.id);
  assert.deepEqual(h.get(id).delivery.messages.map((m) => m.text), ['둘']);
});
