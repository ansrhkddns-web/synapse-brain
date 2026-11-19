// 화면 공용: 상태 이름, 시간 표시, 링크 풀기

export const STATUS = {
  결정대기: { label: '내 결정', tone: 'warn' },
  실행중: { label: '실행 중', tone: 'acc' },
  대기예약: { label: '예약', tone: 'num' },
  검수: { label: '검수', tone: 'ok' },
  완료: { label: '완료', tone: '' },
  취소: { label: '취소', tone: '' },
};

export const OPEN_STATUSES = ['결정대기', '실행중', '대기예약', '검수'];

export const linkTarget = (v) => (typeof v === 'string' ? v.match(/^\[\[([^\]|#]+)/)?.[1] ?? null : null);

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };

// "2026-10-30T17:22" → 오늘이면 "17:22", 아니면 "10/29"
export function shortTime(s) {
  if (!s) return '';
  const [d, t] = String(s).split('T');
  if (d === today()) return t ?? '';
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}`;
}
export const isToday = (s) => String(s ?? '').startsWith(today());

// 도구 이름을 사람 말로 — 대체용. 화면은 서버가 준 한국어(label·now, lib/ko.mjs)를 먼저 쓰고,
// 그게 없는 옛 자료에서만 이것을 쓴다. 모르는 이름은 영어 원이름을 말로 띄우지 않고 "도구"로 (원이름은 title 속성에)
const TOOL_NAMES = {
  mcp__brain__log_progress: '진행 기록',
  mcp__brain__request_decision: '결정 요청',
  mcp__brain__submit_result: '결과 제출',
  mcp__brain__create_task: '위임',
  mcp__brain__write_report: '보고서',
  Read: '파일 읽음', Write: '파일 씀', Edit: '파일 고침', MultiEdit: '파일 고침', Bash: '명령 실행', PowerShell: '명령 실행',
  Glob: '파일 찾음', Grep: '내용 찾음', WebSearch: '웹 검색', WebFetch: '웹 페이지 읽음', TodoWrite: '할 일',
  Agent: '하위 에이전트', Task: '하위 에이전트', Skill: '스킬', Artifact: '아티팩트 게시',
};
export const toolName = (n) => TOOL_NAMES[n] ?? (String(n ?? '').startsWith('mcp__') ? '외부 도구' : '도구');

// 마크다운 기호를 걷어낸 한 줄
export const plain = (s, n = 160) => String(s ?? '')
  .replace(/\*\*|__|`|\[\[|\]\]|^#+\s*/gm, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, n);

// 예약 작업: "매일 07:30 · 다음 10/31(토) 07:30", "매주 토요일 08:00 · 다음 11/7(토) 08:00"
const WEEK = '일월화수목금토';
const repeatLabel = (s) => s.trim().replace(/^(?:매주\s*)?([월화수목금토일])(?:요일)?\s+/, '매주 $1요일 ');
export function scheduleText(task) {
  if (task.status !== '대기예약' || !task.schedule) return null;
  if (!task.next) return `${task.schedule} · 지남`;
  const [d, t] = task.next.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const w = WEEK[new Date(y, m - 1, day).getDay()];
  return `${task.repeat ? repeatLabel(task.schedule) : '한 번'} · 다음 ${m}/${day}(${w}) ${t}`;
}

// 작업 한 줄 요약: 예약 > 실시간 응답 > 마지막 응답
export function taskLine(task, live) {
  return scheduleText(task) ?? plain(live?.[task.id]?.filter((x) => x.kind === 'text').at(-1)?.text ?? task.runtime?.lastText ?? '');
}

// "3분 전", "2시간 전" — 상태 옆에 머문 시간
export function ago(s) {
  if (!s) return '';
  const t = new Date(String(s).replace('T', ' ').replace(/-/g, '/')).getTime();
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}

export const pctTag = (task, pending) => {
  if (task.runtime?.phase === '대기열') return { cls: 'num', text: '대기열' };
  if (pending?.length) return { cls: 'warn', text: pending.some((p) => p.kind === '권한') ? '권한 필요' : '선택 필요' };
  // 앱에서 연 바깥 세션도 일하는 중이면 실행 중(task.live), 쉬고 있으면 쉬는 중 — 두뇌 세션만 '멈춤'이 있다
  if (task.runtime?.phase === '실행' || task.live) return { cls: 'acc', text: '실행 중', spin: true };
  if (task.status === '실행중') return task.tags?.includes('바깥세션') ? { cls: '', text: '쉬는 중' } : { cls: '', text: '멈춤' };
  const s = STATUS[task.status];
  return { cls: s?.tone ?? '', text: s?.label ?? task.status };
};
