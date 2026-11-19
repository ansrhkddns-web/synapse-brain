// 예약 형식
//   한 번:   2026-10-31T07:00
//   반복:   "매일 07:30" | "평일 09:00" | "주말 10:00"
//           요일 하나: "토요일 08:00" | "매주 토 08:00" | "토 08:00" (월~일, 한 글자·요일 둘 다)
// 반복 작업은 틀로 남고(대기예약 그대로), 때가 되면 하위 작업을 새로 만들어 돌린다.

const ONCE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const REPEAT = /^(?:(매일|평일|주말)|(?:매주\s*)?([월화수목금토일])(?:요일)?)\s+(\d{1,2}):(\d{2})$/;
const WEEK = '일월화수목금토'; // Date.getDay() 순서

export function parseSchedule(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  let m = t.match(ONCE);
  if (m) {
    const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return Number.isNaN(at.getTime()) ? null : { kind: 'once', at };
  }
  m = t.match(REPEAT);
  // 요일 하나는 "토요일"로 맞춰 둔다 ("매주 토"·"토"·"토요일" 모두 같은 규칙)
  if (m && +m[3] < 24 && +m[4] < 60) return { kind: 'repeat', days: m[1] ?? `${m[2]}요일`, hour: +m[3], minute: +m[4] };
  return null;
}

const dayOk = (days, d) => {
  const w = d.getDay();
  if (days === '매일') return true;
  if (days === '평일') return w >= 1 && w <= 5;
  if (days === '주말') return w === 0 || w === 6;
  return days === `${WEEK[w]}요일`;
};

const slotOn = (rule, d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), rule.hour, rule.minute);

// 오늘 이미 지난 슬롯(없으면 null)
export function lastSlot(rule, now) {
  if (rule.kind === 'once') return rule.at <= now ? rule.at : null;
  const today = slotOn(rule, now);
  return dayOk(rule.days, now) && today <= now ? today : null;
}

// 다음 실행 시각 (화면 표시용)
export function nextRun(rule, now) {
  if (rule.kind === 'once') return rule.at > now ? rule.at : null;
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const s = slotOn(rule, d);
    if (s > now && dayOk(rule.days, d)) return s;
  }
  return null;
}

const toDate = (s) => (s ? new Date(s.replace('T', ' ').replace(/-/g, '/')) : null);

// 지금 돌려야 하나: 오늘 슬롯이 지났고, 그 슬롯 뒤로 아직 안 돌렸고, 슬롯보다 먼저 만들어진 작업
// (서버가 꺼져 있다 켜지면 그날 놓친 것은 한 번 따라잡는다. 지난 날 것은 건너뛴다)
export function isDue(task, now) {
  const rule = parseSchedule(task.schedule);
  if (!rule) return false;
  const slot = lastSlot(rule, now);
  if (!slot) return false;
  const created = toDate(task.created);
  if (created && created > slot) return false;
  const last = toDate(task.last_run);
  return !last || last < slot;
}

// 작업의 다음 실행 시각 (화면 표시용): 반복은 last_run이 앞에 있으면 그 뒤 슬롯부터
// (오늘 슬롯을 미리 last_run으로 막아 둔 틀이 "다음 오늘"로 보이지 않게)
export function nextFor(task, now) {
  const rule = parseSchedule(task.schedule);
  if (!rule) return null;
  const last = rule.kind === 'repeat' ? toDate(task.last_run) : null;
  return nextRun(rule, last && last > now ? last : now);
}
