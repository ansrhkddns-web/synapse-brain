// 기억 기록 읽기: 기억/주인말·검수·세션지시 파일의 "## 기록" 줄을 항목으로 나눈다 (화면의 기억 탭 · 기억 문서가 쓴다).
//   주인말·검수:  - 09:47 **지시** [[W-261118-001]] 비서실 — 할 말
//   세션지시:     ### [[W-261102-005]] 제목 (부서 / 하위)  아래에  - 09:13 한 말
// 파일은 고치지 않는다 — 읽어서 모양만 바꾼다.
export const MEMORY_TYPES = { 주인말: '주인말', 검수판정: '검수판정', 세션지시: '세션지시' };
const LINE = /^-\s+(\d{1,2}:\d{2})\s+(?:\*\*(.+?)\*\*\s*)?(.*)$/;
const LINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
const linksOf = (s) => [...String(s).matchAll(LINK)].map((m) => m[1].trim());

export function parseMemory(body, { source, date = null, name = null } = {}) {
  const lines = String(body ?? '').split('\n');
  const at = lines.findIndex((l) => l.trim() === '## 기록');
  const out = [];
  let group = null;   // 세션지시: 지금 묶음의 작업
  for (const raw of lines.slice(at < 0 ? 0 : at + 1)) {
    const l = raw.trim();
    const head = /^###\s+(.*)$/.exec(l);
    if (head) {
      const [task = null] = linksOf(head[1]);
      group = { task, title: head[1].replace(LINK, '').trim() };
      continue;
    }
    const m = LINE.exec(l);
    if (!m) continue;
    const [, time, kind = null, rest] = m;
    let text = rest.trim();
    let task = group?.task ?? null;
    // 맨 앞 링크가 이 말이 가리키는 작업이다 (주인말·검수)
    const lead = /^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]\s*/.exec(text);
    if (!group && lead) { task = lead[1].trim(); text = text.slice(lead[0].length); }
    out.push({
      date, time: time.padStart(5, '0'), source, name,
      kind: kind ?? (source === '세션지시' ? '세션 지시' : null),
      task, group: group?.title ?? null, text, links: linksOf(rest),
    });
  }
  return out;
}

// 보관함 파일 목록에서 기억 기록을 날짜별로 (최근 날짜부터). days: 기록이 있는 날 몇 개까지
export function memoryDays(files, { days = 14, name = null } = {}) {
  const byDate = new Map();
  for (const f of files) {
    const type = f.data?.type;
    if (!MEMORY_TYPES[type] || !f.rel.startsWith('기억/')) continue;
    if (name && f.name !== name) continue;
    const date = String(f.data.date ?? '').slice(0, 10);
    if (!date) continue;
    const list = byDate.get(date) ?? byDate.set(date, { date, files: [], entries: [] }).get(date);
    list.files.push({ name: f.name, type });
    list.entries.push(...parseMemory(f.body, { source: type, date, name: f.name }));
  }
  return [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, name ? undefined : days)
    .map((d) => ({ ...d, entries: d.entries.sort((a, b) => b.time.localeCompare(a.time)) }));
}
