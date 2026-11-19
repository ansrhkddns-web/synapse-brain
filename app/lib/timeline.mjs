// 타임라인: 모든 작업의 "## 진행 로그" 줄을 시간순 사건으로 모은다.
// 로그 줄은 "- HH:MM 내용"이라 날짜는 작업을 만든 날에서 시작해, 시각이 거꾸로 가면 다음 날로 넘긴다.

const LINE = /^-\s+(\d{1,2}):(\d{2})\s+(.+)$/;

// 사건 종류 (화면에서 기호·색을 고른다)
export function kindOf(text) {
  if (/^⚠/.test(text)) return 'error';
  if (/결정 요청/.test(text)) return 'decision';
  if (/\[\[D-\d{6}-\d{3}\]\]\s*→|답 받음/.test(text)) return 'answer';
  if (/결과 제출|→ 검수/.test(text)) return 'result';
  if (/^사용자:/.test(text)) return 'user';
  if (/작업 생성/.test(text)) return 'create';
  if (/반복 실행|예약 시각/.test(text)) return 'schedule';
  if (/하위 작업|위임/.test(text)) return 'delegate';
  if (/상태 변경|멈춤|다시 켜짐/.test(text)) return 'state';
  return 'log';
}

const pad = (n) => String(n).padStart(2, '0');

export function buildTimeline(files) {
  const events = [];
  for (const f of files) {
    const d = f.data;
    if (d?.type !== '작업' || typeof d.created !== 'string') continue;
    const section = f.body.split(/^## 진행 로그\s*$/m)[1]?.split(/^## /m)[0] ?? '';
    let day = new Date(d.created.slice(0, 10).replace(/-/g, '/'));
    let lastMin = -1;
    let seq = 0;
    for (const raw of section.split('\n')) {
      const m = raw.trim().match(LINE);
      if (!m) continue;
      const min = Number(m[1]) * 60 + Number(m[2]);
      if (lastMin >= 0 && min < lastMin - 1) day = new Date(day.getTime() + 86400000);
      lastMin = min;
      const at = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${pad(m[1])}:${m[2]}`;
      events.push({
        at, seq: seq++, task: d.id, title: d.title, dept: d.dept, unit: d.unit ?? null, status: d.status,
        text: m[3].trim(), kind: kindOf(m[3].trim()),
      });
    }
  }
  // 최신이 위로. 같은 시각이면 같은 작업 안의 순서를 지킨다
  events.sort((a, b) => b.at.localeCompare(a.at) || a.task.localeCompare(b.task) || b.seq - a.seq);
  return events;
}
