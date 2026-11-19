// 일정비서: 비서실 하위 문서 "일정비서"를 서버가 날짜에 맞게 다시 쓴다 (세션 없이, 읽기만 해서 모은다).
//   바깥 일(Asana 마감·슬랙에서 나한테 온 것·지시방 지시) — 예약된 Claude 세션이 아침마다 기억/일정비서-<날>.json으로 모아 둔다
//   두뇌 안 일(내 차례·오늘 예약·돌고 있는 일·끝낸 일) — 서버가 바로 읽는다
// 내용이 바뀔 때만 쓴다 — 날이 바뀌면 그날 것으로 통째로 바뀐다.
// 섹션 안에서 같은 대상(사람·프로젝트, 두뇌 작업은 하위 항목)의 일정은 대상 아래로 묶는다 — 화면 카드(GET /api/today)와 본문이 같은 모델에서 나온다.
import fs from 'node:fs';
import path from 'node:path';
import { parseSchedule, nextRun, lastSlot } from './schedule.mjs';
import { stamp } from './store.mjs';

export const REL = '부서/비서실/하위/일정비서.md';
export const FEED = (date) => `기억/일정비서-${date}.json`;
// 끝낸 바깥 일: 사람이 완료로 지웠거나(사람) 모음에서 끝났다고 온 것(자동). 날이 바뀌어도 다시 뜨지 않게 30일 둔다
export const CLEARED = '기억/일정비서-완료.json';
const KEEP_DAYS = 30;
// 할 일 → 두뇌 작업: 할 일 카드에서 "시키기"로 만든 작업 (카드를 누르면 그 작업의 대화가 열린다)
export const LINKS = '기억/일정비서-연결.json';
const WEEK = '일월화수목금토';
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const one = (s, n = 90) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const where = (t) => `${t.dept}${t.unit ? ` / ${t.unit}` : ''}`;
const KIND_LABEL = { 결정: '결정', 권한: '권한 허락', 입력대기: '답 기다림', 승인: '단계 승인', 실패: '실패 확인', 멈춤의심: '멈춤 의심', 검수: '검수', 새답: '새 답 확인' };
const dayOf = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s ?? '')) ? String(s).slice(0, 10) : null);
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}(${WEEK[new Date(`${d}T00:00`).getDay()]})`;
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00`) - new Date(`${a}T00:00`)) / 86400000);

// 오늘 이 예약이 도는 시각 (오늘 슬롯이 없으면 null)
function slotToday(rule, now) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400000);
  if (rule.kind === 'once') return rule.at >= start && rule.at < end ? rule.at : null;
  return lastSlot(rule, now) ?? (() => { const n = nextRun(rule, now); return n && n < end ? n : null; })();
}

// 바깥 일 한 줄: [출처] 제목 — 어디 · 마감 · 메모 (링크)
// 같은 일을 알아보는 열쇠들: 모음이 준 id · 링크 · 출처+제목 — 모음이 id를 새로 붙여도 완료 처리가 이어지게
const keysOf = (x) => [x.id, x.url && `u:${x.url}`, `t:${x.source ?? '기타'}:${tkey(x.title ?? '')}`].filter(Boolean).map(String);
export const itemId = (x) => String(x.id ?? (x.url ? `u:${x.url}` : `t:${x.source ?? '기타'}:${tkey(x.title ?? '')}`));
const extCard = (x, date) => {
  const due = dayOf(x.due);
  const late = due && due < date ? daysBetween(due, date) : 0;
  const { target, title } = targetOf(x);
  const bits = [x.where && one(x.where, 40), due && `마감 ${md(due)}${late ? ` · **${late}일 지남**` : ''}`, x.note && one(x.note, 80)].filter(Boolean).join(' · ');
  const box = x.done ? 'x' : ' ';
  const head = x.url ? `[${one(title, 70)}](${x.url})` : one(title, 70);
  return {
    id: itemId(x), raw: x.title, clearable: !x.done, box, source: x.source ?? '기타', kind: x.kind ?? null, target, title: one(title, 70), url: x.url ?? null,
    where: x.where ? one(x.where, 40) : null, due, dueLabel: due ? md(due) : null, late, note: x.note ? one(x.note, 80) : null,
    line: `[${box}] \`${x.source ?? '기타'}\` ${head}${bits ? ` — ${bits}` : ''}`,
  };
};

// 대상: 그 일을 요청했거나 함께 처리할 사람·프로젝트. item.target이 없으면 제목 앞 "이름 직함:"·Asana "[프로젝트]"에서 뽑는다
const RANK = '차장|과장|부장|실장|대리|사원|주임|선임|책임|수석|팀장|본부장|센터장|소장|이사|상무|전무|부사장|사장|대표|회장|매니저|PD|님';
const PERSON = new RegExp(`^([가-힣]{2,4} ?(?:${RANK}))\s*[:：]\s*(.+)$`);
const PROJECT = /^\[([^\]]{1,30})\]\s*(.+)$/;
const tkey = (s) => String(s).replace(/\s+/g, '');
export function targetOf(x) {
  const title = String(x.title ?? '').trim();
  const m = PERSON.exec(title) ?? (x.source === 'Asana' ? PROJECT.exec(title) : null);
  const set = one(x.target ?? '', 30);
  // 정해 준 대상이 제목 앞머리와 같으면 제목에서 뗀다 (카드 머리에 이미 나오므로)
  if (set) return { target: set, title: m && tkey(m[1]) === tkey(set) ? m[2].trim() : title };
  return m ? { target: m[1].replace(/\s+/g, ' ').trim(), title: m[2].trim() } : { target: null, title };
}

// 같은 대상은 섹션 안에서 하나로 (처음 나온 자리에). 대상 없는 일정은 단독 카드
function groupCards(cards) {
  const out = [], at = new Map();
  for (const c of cards) {
    if (!c.target) { out.push(c); continue; }
    let g = at.get(tkey(c.target));
    if (!g) { g = { target: c.target, items: [], also: [] }; at.set(tkey(c.target), g); out.push(g); }
    g.items.push(c);
  }
  return out;
}

export function renderToday({ now, tasks, attention, doneLines, feed, cleared = {}, links = {} }) {
  const date = stamp(now).slice(0, 10);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const link = (id) => (id ? `[[${id}]]` : '');
  const unitOf = (t) => (t ? t.unit || t.dept || null : null);

  // ── 바깥 일 (일정비서 모음)
  const all = Array.isArray(feed?.items) ? feed.items.filter((x) => x && x.title) : [];
  // 끝난 것(모음이 done으로 줬거나 사람이 완료로 지운 것)은 할 일 섹션에서 빼고 "끝낸 일"로
  const clearedKeys = new Set(Object.entries(cleared).flatMap(([id, c]) => [id, ...keysOf({ ...c, id: null, title: c.raw ?? c.title })]));
  const isCleared = (x) => keysOf(x).some((k) => clearedKeys.has(k));
  const items = all.filter((x) => !x.done && !isCleared(x));
  const finished = [
    ...all.filter((x) => x.done && !isCleared(x)).map((x) => ({ x, by: '자동', at: null })),
    ...Object.entries(cleared).filter(([, c]) => dayOf(c.at) === date && c.by !== '스킵').map(([id, c]) => ({ x: { ...c, id, done: true }, by: c.by ?? '사람', at: c.at })),
  ];
  // 내 일 아님(스킵): 오늘 할 일에서 빼고, 오늘 안에는 되돌릴 수 있게 따로 둔다. 30일 동안 다시 뜨지 않는다
  const skipped = Object.entries(cleared).filter(([, c]) => dayOf(c.at) === date && c.by === '스킵');
  const dueOf = (x) => dayOf(x.due);
  const overdue = items.filter((x) => dueOf(x) && dueOf(x) < date).sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
  const dueToday = items.filter((x) => dueOf(x) === date);
  const week = items.filter((x) => dueOf(x) > date && daysBetween(date, dueOf(x)) <= 7).sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
  const missed = items.filter((x) => !dueOf(x) && x.kind === '확인');
  const todo = items.filter((x) => !dueOf(x) && x.kind === '오늘');
  const linkOf = (x) => { for (const k of keysOf(x)) if (links[k]) return links[k]; return null; };
  const withTask = (c, x) => {
    const id = linkOf(x);
    const t = id ? byId.get(id) : null;
    return id ? { ...c, task: id, taskStatus: t?.status ?? null, taskLive: t?.status === '실행중' } : c;
  };
  const ext = (list) => list.map((x) => withTask(extCard(x, date), x));

  // ── 두뇌 안 일 (대상 = 작업의 하위 항목, 없으면 부서)
  const brain = (t, rest) => ({ source: '두뇌', task: t?.id ?? null, target: unitOf(t), where: t ? where(t) : null, url: null, due: null, dueLabel: null, late: 0, note: null, ...rest });
  const mine = attention.map((x) => {
    const t = byId.get(x.task);
    const label = KIND_LABEL[x.kind] ?? x.kind;
    const title = one(t?.title ?? x.title, 70);
    return brain(t, {
      box: ' ', label, task: x.task ?? null, title, note: x.body && !t ? one(x.body, 60) : null,
      line: `[ ] **${label}** ${link(x.task)} ${title}${t ? ` — ${where(t)}` : ''}${x.body && !t ? ` — ${one(x.body, 60)}` : ''}`,
    });
  });
  const today = date.replace(/-/g, '').slice(2);
  const sched = [];
  for (const t of tasks) {
    if (t.status !== '대기예약') continue;
    const rule = parseSchedule(t.schedule);
    const at = rule && slotToday(rule, now);
    if (!at) continue;
    const ran = rule.kind === 'repeat' && tasks.some((c) => String(c.parent ?? '').includes(t.id) && c.id.includes(today));
    const flag = ran ? '돌았음' : at <= now ? '시각 지남' : null;
    sched.push({ at, card: brain(t, {
      box: ran ? 'x' : ' ', time: hm(at), title: one(t.title, 70), flag,
      line: `[${ran ? 'x' : ' '}] ${hm(at)} ${link(t.id)} ${one(t.title, 70)} — ${where(t)}${flag ? ` · ${flag}` : ''}`,
    }) });
  }
  sched.sort((a, b) => a.at - b.at);
  const busy = new Set(attention.map((x) => x.task).filter(Boolean));
  const running = tasks.filter((t) => t.status === '실행중' && !busy.has(t.id))
    .map((t) => brain(t, { box: null, title: one(t.title, 70), line: `${link(t.id)} ${one(t.title, 70)} — ${where(t)}` }));
  // 끝낸 일: 검수 기억의 "완료" 줄 — "- [x] HH:MM [[W-…]] 제목 (검수 → 확인)"
  const done = doneLines.map((l) => {
    const m = /^- \[x\] (\d\d:\d\d) (?:\[\[([^\]]+)\]\] )?(.*)$/.exec(l);
    const t = m?.[2] ? byId.get(m[2]) : null;
    return brain(t, { box: 'x', task: m?.[2] ?? null, time: m?.[1] ?? null, title: m ? m[3] : l.replace(/^- \[x\] /, ''), line: l.replace(/^- /, '') });
  });

  const doneExt = finished.map(({ x, by, at }) => {
    const c = withTask(extCard({ ...x, done: true, note: null }, date), x);
    const why = by === '자동' ? '끝남 확인' : '완료 처리';
    return { ...c, clearable: false, undo: by !== '자동', time: at ? String(at).slice(11, 16) : null, note: why, line: `${c.line} — ${why}` };
  });

  const skipExt = skipped.map(([id, x]) => {
    const c = extCard({ ...x, id, done: true, note: null }, date);
    return { ...c, clearable: false, undo: true, skipped: true, time: String(x.at).slice(11, 16), note: '내 일 아님', line: `${c.line.replace('[x]', '[-]')} — 내 일 아님` };
  });

  const SECTIONS = [
    ['overdue', '마감 지남 — 놓친 것', '마감 지남', ext(overdue), '없음'],
    ['dueToday', '오늘 마감', '오늘 마감', ext(dueToday), '없음'],
    ['todo', '오늘 할 일', '오늘 할 일', ext(todo), '따로 정한 것 없음'],
    ['missed', '확인 못 한 것 — 답·처리가 필요한 연락', '확인 못 한 것', ext(missed), '없음'],
    ['week', '이번 주 마감 (7일 안)', '이번 주 마감', ext(week), '없음'],
    ['mine', '두뇌 — 지금 내 차례', '내 차례', mine, '기다리는 결정·검수 없음'],
    ['sched', '두뇌 — 오늘 예약', '오늘 예약', sched.map((s) => s.card), '오늘 도는 예약 없음'],
    ['running', '두뇌 — 돌고 있는 일', '돌고 있는 일', running, '없음'],
    ['done', '오늘 끝낸 일', '끝낸 일', [...doneExt, ...done], '아직 없음'],
    ...(skipExt.length ? [['skip', '내 일 아님 — 스킵한 것', '내 일 아님', skipExt, '없음']] : []),
  ];
  const sections = SECTIONS.map(([key, title, short, cards, empty]) => ({ key, title, short, count: cards.length, empty, entries: groupCards(cards) }));
  // 같은 대상이 다른 섹션에도 있으면 대상 카드에 적는다 (섹션은 그대로, 묶음은 섹션 안에서만)
  const seen = new Map();
  for (const s of sections) for (const e of s.entries) if (e.items) seen.set(tkey(e.target), [...(seen.get(tkey(e.target)) ?? []), s.short]);
  for (const s of sections) for (const e of s.entries) if (e.items) e.also = seen.get(tkey(e.target)).filter((x) => x !== s.short);

  const rowsOf = (entries) => entries.flatMap((e) => (e.items
    ? [`- **${e.target}** (${e.items.length})${e.also.length ? ` · ${e.also.join('·')}에도 있음` : ''}`, ...e.items.map((c) => `  - ${c.line}`)]
    : [`- ${e.line}`]));
  const sec = (s) => [`## ${s.title}${s.count ? ` (${s.count})` : ''}`, '', ...(s.count ? rowsOf(s.entries) : [`- ${s.empty}`]), ''];
  const fed = feed?.at ? `바깥 일은 ${one(feed.at, 16).replace('T', ' ')}에 모음 (${(feed.sources ?? []).join('·') || '출처 없음'})` : '바깥 일(Asana·슬랙·지시방)은 아직 오늘 모으지 않음 — 일정비서 예약이 돌면 채워진다';
  const title = `일정비서 · ${date} (${WEEK[now.getDay()]})`;
  const intro = `오늘 할 일, 언제까지인지, 놓친 건 없는지. 위에서부터 처리하면 된다. ${fed}.`;
  const summary = feed?.summary ? one(feed.summary, 300) : null;
  const body = [
    `# ${title}`, '',
    intro, '',
    ...(summary ? [`> ${summary}`, ''] : []),
    ...sections.flatMap(sec),
  ].join('\n');
  return { date, body, view: { date, title, intro, summary, sections } };
}

// 검수 기억 파일에서 오늘 "완료" 줄
export function doneLinesOf(root, date) {
  try {
    return fs.readFileSync(path.join(root, '기억', `검수-${date}.md`), 'utf8').split('\n')
      .filter((l) => /^- \d\d:\d\d \*\*완료\*\*/.test(l))
      .map((l) => `- [x] ${l.slice(2).replace(' **완료** ', ' ')}`);
  } catch { return []; }
}

export function readFeed(root, date) {
  try { return JSON.parse(fs.readFileSync(path.join(root, FEED(date)), 'utf8')); } catch { return null; }
}

export function readCleared(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, CLEARED), 'utf8')).items ?? {}; } catch { return {}; }
}

export function readLinks(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, LINKS), 'utf8')).items ?? {}; } catch { return {}; }
}

// 할 일 카드에서 시킬 때 세션이 받을 지시문 (할 일의 내용·출처·링크를 함께)
export function askInstruction(card, text) {
  return [
    text.trim(), '',
    `[일정비서 할 일] ${card.target && card.source !== '두뇌' ? `${card.target} · ` : ''}${card.title}`,
    `- 출처: ${card.source}${card.where ? ` · ${card.where}` : ''}${card.dueLabel ? ` · 마감 ${card.dueLabel}${card.late ? ` (${card.late}일 지남)` : ''}` : ''}`,
    card.note && `- 메모: ${card.note}`,
    card.url && `- 링크: ${card.url}`,
    '- Asana·슬랙에 글을 쓰거나 보내야 하면, 보내기 전에 보낼 내용을 결정 카드로 먼저 보여 준다.',
  ].filter(Boolean).join('\n');
}

export function createToday({ root, collect, emit = () => {}, now = () => new Date(), every = 60000 }) {
  const file = path.join(root, REL);
  let last = null;
  const build = (t) => { const date = stamp(t).slice(0, 10); return renderToday({ now: t, feed: readFeed(root, date), doneLines: doneLinesOf(root, date), cleared: readCleared(root), links: readLinks(root), ...collect(t) }); };
  const cardOf = (id) => build(now()).view.sections.flatMap((s) => s.entries.flatMap((e) => (e.items ? e.items.map((c) => ({ ...c, target: e.target })) : [e]))).find((c) => c.id === id) ?? null;
  // 할 일 ↔ 작업 잇기 (같은 일의 다른 열쇠로도 찾게 id·링크·제목을 다 적는다)
  function link(id, task) {
    const card = cardOf(id);
    if (!card) return null;
    const items = readLinks(root);
    for (const k of keysOf({ id: card.id, url: card.url, source: card.source, title: card.raw ?? card.title })) items[k] = task;
    fs.mkdirSync(path.dirname(path.join(root, LINKS)), { recursive: true });
    fs.writeFileSync(path.join(root, LINKS), JSON.stringify({ items }, null, 2));
    refresh();
    return card;
  }
  // 완료로 지우기(undo면 되살리기, skip이면 내 일 아님으로 빼기). 지운 일은 오늘 "끝낸 일"·"내 일 아님"에 남는다
  function clear(id, { undo = false, skip = false } = {}) {
    const t = now();
    const items = readCleared(root);
    const cutoff = stamp(new Date(t.getTime() - KEEP_DAYS * 86400000));
    for (const [k, c] of Object.entries(items)) if (String(c.at ?? '') < cutoff) delete items[k];
    let card = null;
    if (undo) {
      card = items[id] ?? null;
      delete items[id];
    } else {
      card = build(t).view.sections.flatMap((s) => s.entries.flatMap((e) => e.items ?? [e])).find((c) => c.id === id && c.clearable);
      if (!card) return null;
      items[id] = { at: stamp(t), by: skip ? '스킵' : '사람', source: card.source, title: card.target && card.source !== '두뇌' ? `${card.target}: ${card.title}` : card.title, raw: card.raw, url: card.url, due: card.due, where: card.where };
    }
    fs.mkdirSync(path.dirname(path.join(root, CLEARED)), { recursive: true });
    fs.writeFileSync(path.join(root, CLEARED), JSON.stringify({ items }, null, 2));
    refresh();
    return card;
  }
  function refresh() {
    const t = now();
    const { date, body } = build(t);
    if (body === last) return false;
    let old = null;
    try { old = fs.readFileSync(file, 'utf8'); } catch { /* 처음 */ }
    if (old && old.split('\n---\n').slice(1).join('\n---\n').trim() === body.trim()) { last = body; return false; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      '---', 'type: 하위', 'name: 일정비서', 'dept: 비서실', 'order: 0',
      `summary: 오늘(${date}) 할 일 — 마감·놓친 연락·두뇌 차례를 날마다 새로 모은다`,
      'color: "#e5c07b"', 'match:', '  - 일정비서', '  - 오늘 할 일', '  - 마감 체크',
      `date: ${date}`, `updated: ${stamp(t)}`, 'generated: true', '---', body, '',
    ].join('\n'));
    last = body;
    emit('task', { id: null });
    return true;
  }
  let timer = null;
  const safe = () => { try { refresh(); } catch (e) { console.error('일정비서 갱신 실패:', e.message); } };
  return {
    refresh,
    clear,
    link,
    cardOf,
    // 화면 카드용: 섹션 → 대상 묶음 → 일정 카드 (본문 마크다운과 같은 모델)
    view: () => build(now()).view,
    start() { safe(); timer = setInterval(safe, every); timer.unref?.(); },
    stop() { clearInterval(timer); },
  };
}
