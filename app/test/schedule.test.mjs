import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule, isDue, nextRun, nextFor } from '../lib/schedule.mjs';
import { createScheduler } from '../lib/scheduler.mjs';

const at = (s) => new Date(s.replace('T', ' ').replace(/-/g, '/'));

test('예약 형식 읽기', () => {
  assert.equal(parseSchedule('2026-10-31T07:00').kind, 'once');
  assert.deepEqual(parseSchedule('매일 07:30'), { kind: 'repeat', days: '매일', hour: 7, minute: 30 });
  assert.equal(parseSchedule('평일 9:05').hour, 9);
  for (const bad of ['매일', '매일 25:00', '내일 7시', '2026-10-31 07:00', null, '']) assert.equal(parseSchedule(bad), null, String(bad));
});

test('반복: 오늘 슬롯이 지났고 아직 안 돌았으면 돌린다', () => {
  const task = { schedule: '매일 07:30', created: '2026-10-29T10:00', last_run: null };
  assert.equal(isDue(task, at('2026-10-30T07:29')), false);
  assert.equal(isDue(task, at('2026-10-30T07:30')), true);
  assert.equal(isDue({ ...task, last_run: '2026-10-30T07:30' }, at('2026-10-30T12:00')), false);
  assert.equal(isDue({ ...task, last_run: '2026-10-29T07:30' }, at('2026-10-30T12:00')), true); // 꺼져 있던 날 따라잡기
});

test('반복: 슬롯 뒤에 만든 작업은 다음 날부터', () => {
  const task = { schedule: '매일 07:30', created: '2026-10-30T09:00', last_run: null };
  assert.equal(isDue(task, at('2026-10-30T09:01')), false);
  assert.equal(isDue(task, at('2026-10-31T07:30')), true);
});

test('평일·주말', () => {
  const task = { schedule: '평일 09:00', created: '2026-10-01T00:00', last_run: null };
  assert.equal(isDue(task, at('2026-10-31T10:00')), false); // 토요일
  assert.equal(isDue(task, at('2026-10-30T10:00')), true);  // 금요일
  assert.equal(nextRun(parseSchedule('평일 09:00'), at('2026-10-30T10:00')).getDay(), 1); // 다음은 월요일
  assert.equal(isDue({ ...task, schedule: '주말 10:00' }, at('2026-10-31T10:00')), true);
});

test('요일 반복: 형식 읽기', () => {
  const sat = { kind: 'repeat', days: '토요일', hour: 8, minute: 0 };
  for (const s of ['토요일 08:00', '매주 토 08:00', '매주 토요일 8:00', '토 08:00', '매주토 08:00', ' 토요일 08:00 ']) assert.deepEqual(parseSchedule(s), sat, s);
  assert.equal(parseSchedule('일요일 23:59').days, '일요일');
  assert.equal(parseSchedule('월 07:00').days, '월요일');
  for (const bad of ['토요일', '토요일 24:00', '매주 08:00', '토일 08:00', '토요 08:00', '매주 주말 08:00', '매주매일 08:00']) assert.equal(parseSchedule(bad), null, bad);
});

test('요일 반복: 그 요일에만 돈다', () => {
  const task = { schedule: '토요일 08:00', created: '2026-10-31T09:00', last_run: null }; // 10/31(토) 슬롯 뒤에 만든 틀
  assert.equal(isDue(task, at('2026-10-31T10:00')), false);  // 만들기 전 슬롯
  assert.equal(isDue(task, at('2026-11-01T08:00')), false);  // 일요일
  assert.equal(isDue(task, at('2026-11-06T08:00')), false);  // 금요일
  assert.equal(isDue(task, at('2026-11-07T07:59')), false);
  assert.equal(isDue(task, at('2026-11-07T08:00')), true);   // 다음 토요일
  assert.equal(isDue({ ...task, last_run: '2026-11-07T08:00' }, at('2026-11-07T20:00')), false);
  assert.equal(isDue({ ...task, schedule: '매주 토 08:00' }, at('2026-11-07T08:00')), true);
  assert.equal(isDue({ ...task, schedule: '일 08:00' }, at('2026-11-07T08:00')), false);
  assert.equal(isDue({ ...task, schedule: '일 08:00' }, at('2026-11-08T08:00')), true);
});

test('요일 반복: 다음 실행', () => {
  const rule = parseSchedule('토요일 08:00');
  assert.deepEqual(nextRun(rule, at('2026-10-31T10:00')), at('2026-11-07T08:00')); // 오늘 지났으면 다음 주
  assert.deepEqual(nextRun(rule, at('2026-10-31T07:00')), at('2026-10-31T08:00')); // 오늘 아직이면 오늘
  assert.deepEqual(nextRun(rule, at('2026-11-02T00:00')), at('2026-11-07T08:00'));
  assert.deepEqual(nextRun(parseSchedule('월 09:30'), at('2026-10-31T10:00')), at('2026-11-02T09:30'));
});

test('오늘 슬롯을 last_run으로 막아 둔 틀: 돌지 않고, 다음은 다음 주로 보인다', () => {
  const task = { schedule: '토요일 08:00', created: '2026-10-31T01:50', last_run: '2026-10-31T08:00' };
  assert.equal(isDue(task, at('2026-10-31T08:00')), false);
  assert.equal(isDue(task, at('2026-11-07T08:00')), true);
  assert.deepEqual(nextFor(task, at('2026-10-31T01:50')), at('2026-11-07T08:00'));
  assert.deepEqual(nextFor({ ...task, last_run: null }, at('2026-10-31T01:50')), at('2026-10-31T08:00'));
  assert.equal(nextFor({ schedule: '2026-10-30T15:00', last_run: null }, at('2026-10-31T00:00')), null);
});

test('한 번 예약', () => {
  const task = { schedule: '2026-10-30T15:00', created: '2026-10-30T09:00', last_run: null };
  assert.equal(isDue(task, at('2026-10-30T14:59')), false);
  assert.equal(isDue(task, at('2026-10-30T15:00')), true);
});

// 예약 실행기를 메모리 속 가짜 보관함으로 돌린다
function fakeScheduler(task, clock) {
  const tasks = { [task.id]: { ...task } };
  const logs = [];
  let n = 0;
  const store = {
    listTasks: () => Object.values(tasks),
    readTask: (id) => ({ data: tasks[id], body: '## 지시\n\n주간 보고\n\n## 진행 로그\n' }),
    patchTask: async (id, p) => { Object.assign(tasks[id], p); },
    appendLog: async (id, text) => { logs.push(`${id} ${text}`); },
    createTask: async (t) => { const id = `C-${++n}`; tasks[id] = { id, status: '실행중', ...t }; return id; },
  };
  const s = createScheduler({ store, runner: { start: () => {} }, now: () => clock.now });
  return { s, tasks, logs };
}

test('W-261031-003 사고: 일요일 정기 검사로는 돌지 않고, 지금 실행만 돌며 로그에 사람 실행으로 남는다', async () => {
  const clock = { now: at('2026-11-01T00:41') };
  const tmpl = { id: 'W-261031-003', status: '대기예약', title: 'Voxyn 주간', schedule: '토요일 08:00', created: '2026-10-31T01:45', last_run: '2026-10-31T08:00' };
  const { s, tasks, logs } = fakeScheduler(tmpl, clock);
  assert.deepEqual(await s.tick(), []); // 결정 처리 등과 상관없이 tick은 dayOk·last_run을 본다
  assert.equal(tasks['W-261031-003'].last_run, '2026-10-31T08:00');

  assert.equal(await s.runNow('W-261031-003'), 'C-1');
  assert.equal(tasks['W-261031-003'].last_run, '2026-11-01T00:41');
  assert.deepEqual(logs, ['W-261031-003 00:41 지금 실행(사람) → [[C-1]]']);
  assert.equal(tasks['C-1'].title, 'Voxyn 주간 11/1');
});

test('지금 실행 뒤 last_run 2026-11-01T00:41 기준: 11/7(토) 08:00에 한 번만 돈다', async () => {
  const clock = { now: at('2026-11-01T00:42') };
  const tmpl = { id: 'T', status: '대기예약', title: 'Voxyn 주간', schedule: '토요일 08:00', created: '2026-10-31T01:45', last_run: '2026-11-01T00:41' };
  const { s, tasks, logs } = fakeScheduler(tmpl, clock);
  const runs = [];
  for (let t = at('2026-11-01T00:42').getTime(); t <= at('2026-11-08T12:00').getTime(); t += 30000) {
    clock.now = new Date(t);
    for (const id of await s.tick()) runs.push([id, tasks.T.last_run]);
  }
  assert.deepEqual(runs, [['C-1', '2026-11-07T08:00']]);
  assert.deepEqual(logs, ['T 08:00 반복 실행 → [[C-1]]']);
  assert.deepEqual(nextFor(tasks.T, at('2026-11-07T08:01')), at('2026-11-14T08:00'));
});

test('지금 실행은 미리 막아 둔 앞 슬롯(지금보다 뒤의 last_run)을 풀지 않는다', async () => {
  const clock = { now: at('2026-10-31T01:50') };
  const tmpl = { id: 'T', status: '대기예약', title: '주간', schedule: '토요일 08:00', created: '2026-10-31T01:45', last_run: '2026-10-31T08:00' };
  const { s, tasks } = fakeScheduler(tmpl, clock);
  await s.runNow('T');
  assert.equal(tasks.T.last_run, '2026-10-31T08:00');
  clock.now = at('2026-10-31T08:00');
  assert.deepEqual(await s.tick(), []); // 오늘 08:00은 여전히 막혀 있다
});
