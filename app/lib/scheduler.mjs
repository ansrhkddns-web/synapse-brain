// 예약 실행기: 대기예약 작업을 30초마다 살펴 때가 되면 돌린다.
//   한 번 예약 → 그 작업을 실행중으로 바꿔 시작
//   반복 예약 → 틀은 그대로 두고 하위 작업을 새로 만들어 시작, 틀의 last_run을 고친다
import { isDue, parseSchedule } from './schedule.mjs';
import { stamp } from './store.mjs';

const instructionOf = (body) => body.split('## 진행 로그')[0].replace('## 지시', '').trim();
const pad = (n) => String(n).padStart(2, '0');

export function createScheduler({ store, runner, emit = () => {}, now = () => new Date(), every = 30000 } = {}) {
  let timer = null;
  let busy = false;

  // manual: 화면의 '지금 실행' — 때를 따지지 않고 돌리므로 로그에 따로 남긴다
  async function run(id, { manual = false } = {}) {
    const { data, body } = store.readTask(id);
    const rule = parseSchedule(data.schedule);
    if (!rule) throw Object.assign(new Error(`${id}: 예약 형식이 아님`), { status: 400 });
    const t = now();
    if (rule.kind === 'once') {
      await store.patchTask(id, { status: '실행중' });
      await store.appendLog(id, manual ? '지금 실행(사람) → 시작' : '예약 시각 → 시작');
      runner.start(id);
      emit('task', { id });
      return id;
    }
    const child = await store.createTask({
      dept: data.dept,
      title: `${data.title} ${t.getMonth() + 1}/${t.getDate()}`,
      instruction: instructionOf(body),
      parent: id,
    });
    // 지금 실행이 미리 막아 둔 앞 슬롯(지금보다 뒤의 last_run)을 풀지 않게, 더 늦은 값을 남긴다
    const last = data.last_run ? String(data.last_run) : null;
    await store.patchTask(id, { last_run: manual && last > stamp(t) ? last : stamp(t) });
    await store.appendLog(id, `${pad(t.getHours())}:${pad(t.getMinutes())} ${manual ? '지금 실행(사람)' : '반복 실행'} → [[${child}]]`);
    runner.start(child);
    emit('task', { id: child });
    return child;
  }

  async function tick() {
    if (busy) return [];
    busy = true;
    const started = [];
    try {
      const t = now();
      for (const task of store.listTasks()) {
        if (task.status !== '대기예약' || !isDue(task, t)) continue;
        try { started.push(await run(task.id)); } catch (e) { await store.appendLog(task.id, `⚠ 예약 실행 실패: ${e.message}`).catch(() => {}); }
      }
    } finally { busy = false; }
    return started;
  }

  return {
    tick,
    runNow: (id) => run(id, { manual: true }),
    start: () => { timer = setInterval(tick, every); tick(); },
    stop: () => clearInterval(timer),
  };
}
