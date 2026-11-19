// 프로세스 지도 배치 (마인드맵): 가운데 비서실장 → 좌우로 부서 → 하위 항목 → 작업 카드 → 하위 작업·결정·보고서.
// 모든 가지는 그 자리에서 펼치고 접는다(부서를 눌러도 다른 화면으로 들어가지 않는다).
// 크기를 정해 두고 계산만으로 놓는다: 가지의 높이 = 펼친 자식 높이의 합, 노드는 자기 자식 덩어리의 가운데.
export const SIZE = {
  chief: { w: 96, h: 96 },
  dept: { w: 168, h: 36 },
  unit: { w: 150, h: 30 },
  card: { w: 260, h: 124 },
  child: { w: 220, h: 64 },
  dec: { w: 236, h: 46 },
  rep: { w: 214, h: 38 },
  more: { w: 156, h: 26 },
  usage: { w: 300, h: 250 },
  taxcal: { w: 280, h: 132 },
  proc: { w: 300, h: 112 },
  pcs: { w: 290, h: 100 },
  prog: { w: 250, h: 40 },
  tsec: { w: 176, h: 32 },
  titem: { w: 300, h: 58 },
};
// 배율·보기에 따라 바뀌는 크기 — 멀리(compact)는 카드가 "상태 + 큰 제목 한 줄"이라 넓고 낮다.
//   res: 오늘 보기의 끝난 카드(결과 한 줄을 더 보여 줌) · pile: 자료 더미 표식이 붙은 칩(조금 넓게)
//   작업 중 아닌 프로그램은 작게, PC 사용량 계기판은 접혀 있으면 한 줄
export function sizeOf(n, o = {}) {
  const s = SIZE[n.kind];
  if (n.kind === 'card') return o.compact ? { w: 300, h: n.res ? 104 : 60 } : s;
  if (n.kind === 'child') return o.compact ? { w: 260, h: 50 } : s;
  if (n.kind === 'prog') return n.live ? s : { w: 214, h: 28 };
  if (n.kind === 'usage') return o.gauge ? s : { w: 236, h: 34 };
  if (n.kind === 'unit' && n.pile) return { w: 192, h: s.h };
  if (n.kind === 'dept' && n.pile) return { w: 212, h: s.h };
  return s;
}
const GAP_X0 = { chief: 150, dept: 90, unit: 70, card: 64, child: 56, more: 60, pcs: 50, proc: 64, tsec: 56 };
// 어디 일인지 모르는 바깥 일은 이 가짜 부서 아래로
export const STRAY = { name: '미분류', order: 99, color: '#8a8f98', stray: true };
// 자원관리부 / PC사용량: 일이 없어도 늘 지도에 두고, 맨 앞 자식으로 사용량 계기판을 단다
const GAUGE = { dept: '자원관리부', unit: 'PC사용량' };
// 세무달력 카드가 붙는 자리 (경영지원실 / 재경부) — 누르면 달력 보기(#/calendar)
export const TAX = { dept: '경영지원실', unit: '재경부' };
// 일정비서 (비서실 / 일정비서): 섹션(마감 지남·오늘 마감·오늘 할 일·확인 못 한 것·이번 주 마감·오늘 예약·끝낸 일)을 하위 카드로, 그 안의 일정을 다시 하위 카드로
export const TODAY = { dept: '비서실', unit: '일정비서' };
const TODAY_KEYS = ['overdue', 'dueToday', 'todo', 'missed', 'week', 'sched', 'done', 'skip'];
const GAP_Y0 = 14;
const DEPT_GAP0 = 34;

// 지도의 나무 만들기 — open: 사용자가 펼치거나 접은 기록(id → bool). 없으면 기본값:
//   부서·하위 항목은 일이 있으면 펼침, 작업은 하위 작업·결정이 있으면 펼침(보고서만 있으면 접음), "오늘 끝"은 접음
//   outside: PC에서 도는 바깥 일 { sessions, programs } (lib/activity.mjs) — 그 부서·하위 항목 아래에 세션 카드, 세션 아래에 프로그램
//   doneInline: 오늘 보기 — 오늘 끝난 일을 "+N 오늘 끝"으로 접지 않고 제자리(하위 항목) 카드로 편다(res = 결과 줄 자리)
//   turn: 내 차례 { tasks: Map(작업 id → 'wait'|'answer'), sessions: Map(세션 id → …) } · piles: Map(하위·부서 문서 id → 자료 더미)
export function buildTree({ depts, units, processes = [], outside = { sessions: [], programs: [] }, tasks: openTasks, done, pending, reports, open, filter, doneInline = false, turn = null, piles = null, today = null }) {
  const doneIds = new Set();
  if (doneInline) for (const l of done.values()) for (const t of l) doneIds.add(t.id);
  const tasks = doneInline ? [...openTasks, ...[...done.values()].flat()] : openTasks;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kidsOf = (id) => tasks.filter((t) => t.parentId === id);
  const isOpen = (id, dflt) => (open.has(id) ? open.get(id) : dflt);

  const taskNode = (t, kind, isDone = doneIds.has(t.id)) => {
    const children = [
      ...kidsOf(t.id).map((c) => taskNode(c, 'child')),
      ...(pending.get(t.id) ?? []).map((d) => ({ id: `dec:${d.id}`, kind: 'dec', decision: d, task: t, children: [] })),
      ...(reports.get(t.id) ?? []).map((r) => ({ id: `rep:${r.id}`, kind: 'rep', report: r, task: t, children: [] })),
    ];
    const hot = children.some((c) => c.kind === 'child' || c.kind === 'dec');
    return { id: t.id, kind, task: t, done: isDone, res: isDone && doneInline, turn: turn?.tasks.get(t.id) ?? null, children, open: isOpen(t.id, hot) };
  };

  // 공정 이름에서 하위 항목 이름을 뺀 말 (몬티 편제작 → 편제작, 영화리뷰 제작 → 없음)
  const procWords = (p, unit) => (p.title ?? p.name).replace(unit, '').split(/[\s\-_]+/).filter((w) => w.length >= 2 && w !== '제작');
  const procNode = (p) =>({ id: `p:${p.id}`, kind: 'proc', proc: p, children: [], live: p.status === '가동' });
  // 바깥 일: links = 이 노드와 연계된 다른 노드 id (작업 카드·공정) — 지도에 바깥쪽 호로 잇는다
  const progNode = (g) => ({ id: `g:${g.key}`, kind: 'prog', prog: g, children: [], live: g.cpu >= 3 || g.gpu >= 3, links: [...(g.tasks ?? []), ...(g.proc && !g.session ? [`p:${g.proc}`] : [])] });
  const sessNode = (s) => {
    const id = `s:${s.id}`;
    const kids = outside.programs.filter((g) => g.session === s.id).map(progNode);
    return { id, kind: 'pcs', sess: s, children: kids, open: isOpen(id, true), live: s.state === '작업중', turn: turn?.sessions.get(s.id) ?? null, links: [...s.tasks, ...(s.proc ? [`p:${s.proc}`] : [])] };
  };
  const deptNames = new Set(depts.map((d) => d.name));
  const outsideOf = (dept, unit) => [
    ...outside.sessions.filter((s) => s.dept === dept && (s.unit ?? null) === unit).map(sessNode),
    ...outside.programs.filter((g) => !g.session && g.dept === dept && (g.unit ?? null) === unit).map(progNode),
  ];
  const hasUnit = (dept, unit) => units.some((u) => u.dept === dept && u.name === unit);
  const stray = (x) => !x.dept || !deptNames.has(x.dept);

  const deptNodes = depts.filter((d) => !filter || d.name === filter).map((d) => {
    const mine = tasks.filter((t) => t.dept === d.name && !(t.parentId && byId.has(t.parentId)));
    const children = [];
    for (const u of units.filter((x) => x.dept === d.name)) {
      const list = mine.filter((t) => t.unit === u.name);
      const gauge = d.name === GAUGE.dept && u.name === GAUGE.unit;
      const procs = processes.filter((p) => p.dept === d.name && p.unit === u.name);
      const outs = outsideOf(d.name, u.name);
      // 등록된 하위 항목은 일이 없어도 뜬다 (눌러서 명령·문서를 볼 수 있게)
      const id = `u:${d.name}/${u.name}`;
      // 공정(작업 프로세스)은 돌지 않아도 맨 앞에 — 그 아래로 바깥 일, 이 하위 항목의 작업 카드.
      // 작업 카드는 자기 공정 밑으로: 제목에 공정 이름(하위 이름을 뺀 말)이 있는 공정, 없으면 공정이 하나뿐일 때 그 공정
      const pnodes = procs.map(procNode);
      const loose = [];
      for (const t of list) {
        const home = pnodes.find((pn) => procWords(pn.proc, u.name).some((w) => t.title?.includes(w))) ?? (pnodes.length === 1 ? pnodes[0] : null);
        (home ? home.children : loose).push(taskNode(t, 'card'));
      }
      for (const pn of pnodes) pn.open = isOpen(pn.id, true);
      const kids = [...pnodes, ...outs, ...loose];
      if (gauge) kids.unshift({ id: 'usage', kind: 'usage', dept: d, children: [] });
      if (d.name === TAX.dept && u.name === TAX.unit) kids.unshift({ id: 'taxcal', kind: 'taxcal', dept: d, children: [] });
      if (d.name === TODAY.dept && u.name === TODAY.unit && today) kids.unshift(...todayNodes(today, isOpen));
      children.push({ id, kind: 'unit', unit: u, dept: d, children: kids, open: isOpen(id, true), pile: piles?.get(u.id ?? `하위:${d.name}/${u.name}`) ?? null });
    }
    for (const p of processes.filter((x) => x.dept === d.name && !units.some((u) => u.dept === d.name && u.name === x.unit))) children.push(procNode(p));
    children.push(...outsideOf(d.name, null));
    for (const s of outside.sessions.filter((x) => x.dept === d.name && x.unit && !hasUnit(d.name, x.unit))) children.push(sessNode(s));
    for (const t of mine.filter((x) => !x.unit || !units.some((u) => u.dept === d.name && u.name === x.unit))) children.push(taskNode(t, 'card'));
    const doneList = doneInline ? [] : done.get(d.name) ?? [];
    if (doneList.length) {
      const id = `m:${d.name}`;
      children.push({ id, kind: 'more', dept: d, count: doneList.length, children: doneList.map((t) => taskNode(t, 'card', true)), open: isOpen(id, false) });
    }
    const id = `d:${d.name}`;
    const always = children.some((c) => c.kind === 'unit' || c.kind === 'proc' || c.kind === 'pcs' || c.kind === 'prog' || c.children.some((k) => ['usage', 'taxcal', 'proc', 'pcs', 'prog'].includes(k.kind)));
    return { id, kind: 'dept', dept: d, children, open: isOpen(id, mine.length > 0 || always), pile: piles?.get(`부서:${d.name}`) ?? null };
  });
  // 어디 일인지 모르는 바깥 세션·프로그램
  const lost = [...outside.sessions.filter(stray).map(sessNode), ...outside.programs.filter((g) => !g.session && stray(g)).map(progNode)];
  if (!filter && lost.length) deptNodes.push({ id: 'd:미분류', kind: 'dept', dept: STRAY, children: lost, open: isOpen('d:미분류', true) });
  return deptNodes;
}

// 접힌 가지 안에 든 작업 수 ("+N" 표시용)
// 일정비서 섹션 카드 → 일정 카드 (대상 묶음은 풀어서 한 줄씩, 대상 이름은 카드 앞머리에). 빈 섹션은 뺀다, 끝낸 일은 접어 둔다
function todayNodes(view, isOpen) {
  return TODAY_KEYS.map((k) => view.sections.find((s) => s.key === k)).filter((s) => s && s.count > 0).map((s) => {
    const id = `ts:${s.key}`;
    const items = s.entries.flatMap((e) => (e.items ? e.items.map((c) => ({ ...c, target: e.target })) : [e]));
    return { id, kind: 'tsec', sec: s, children: items.map((c, i) => ({ id: `ti:${s.key}:${c.id ?? c.task ?? i}`, kind: 'titem', item: c, sec: s.key, children: [] })), open: isOpen(id, s.key !== 'done' && s.key !== 'skip') };
  });
}

export function countTasks(n) {
  return n.children.reduce((s, c) => s + (['card', 'child', 'pcs', 'titem'].includes(c.kind) ? 1 : 0) + countTasks(c), 0);
}
const live = (n) => !!n.task?.live || !!n.live || n.children.some(live);
// "지금" 보기에서 또렷하게 둘 것: 도는 것·내 차례와 그 가지 (나머지는 흐리게)
const focus = (n) => !!n.task?.live || !!n.live || !!n.turn || n.children.some(focus);
// 접힌 가지 안에 숨은 내 차례 수 (화면 밖 화살표가 그 가지를 가리키게)
const turnsIn = (list, only = null) => list.reduce((a, c) => a + (c.turn && (!only || c.turn === only) ? 1 : 0) + turnsIn(c.children, only), 0);
// 시냅스가 흐르는 빠르기 (월드 px/초) — 선 길이로 한 바퀴 시간을 정한다
const SPEED = 170;
const approxLen = ([ax, ay], [bx, by]) => Math.hypot(bx - ax, by - ay) * 1.12;

// o.compact: 멀리 보기(카드를 낮고 넓게) · o.gauge: PC 사용량 계기판을 펼쳤는지
export function layoutMap(deptNodes, o = {}) {
  // 멀리 보기는 카드가 낮아진 만큼 간격을 넓힌다 — 빼곡하지 않게, 예전 같은 거리감
  const GAP_Y = o.compact ? 30 : GAP_Y0;
  const DEPT_GAP = o.compact ? 80 : DEPT_GAP0;
  const GAP_X = o.compact ? Object.fromEntries(Object.entries(GAP_X0).map(([k, v]) => [k, Math.round(v * 1.6)])) : GAP_X0;
  const nodes = [];
  const edges = [];
  const height = (n) => {
    const s = sizeOf(n, o);
    if (!n.open || !n.children.length) return (n.H = s.h);
    const sum = n.children.reduce((a, c) => a + height(c), 0) + GAP_Y * (n.children.length - 1);
    return (n.H = Math.max(s.h, sum));
  };
  // edge = 이 노드가 붙을 안쪽 가장자리 x (오른쪽 가지는 왼쪽 끝, 왼쪽 가지는 오른쪽 끝)
  const place = (n, edge, top, side, parentAnchor) => {
    const s = sizeOf(n, o);
    const x = side === 1 ? edge : edge - s.w;
    const y = top + (n.H - s.h) / 2;
    const node = { ...n, x, y, w: s.w, h: s.h, side, hidden: n.open ? 0 : countTasks(n), live: live(n), focus: focus(n), turnIn: n.open ? 0 : turnsIn(n.children), waitIn: n.open ? 0 : turnsIn(n.children, 'wait') };
    nodes.push(node);
    if (parentAnchor) {
      const to = [side === 1 ? x : x + s.w, y + s.h / 2];
      edges.push({ id: `t:${n.id}`, from: parentAnchor, to, d: curve(parentAnchor, to), len: approxLen(parentAnchor, to), dur: approxLen(parentAnchor, to) / SPEED, kind: n.done ? 'done' : n.kind === 'dept' ? 'trunk' : 'branch', live: node.live, focus: node.focus });
    }
    if (!n.open || !n.children.length) return;
    const outer = side === 1 ? x + s.w : x;
    const childEdge = side === 1 ? outer + GAP_X[n.kind] : outer - GAP_X[n.kind];
    const total = n.children.reduce((a, c) => a + c.H, 0) + GAP_Y * (n.children.length - 1);
    let cy = top + (n.H - total) / 2;
    for (const c of n.children) {
      place(c, childEdge, cy, side, [outer, y + s.h / 2]);
      cy += c.H + GAP_Y;
    }
  };

  nodes.push({ kind: 'chief', id: 'chief', x: -SIZE.chief.w / 2, y: -SIZE.chief.h / 2, ...SIZE.chief, children: [], focus: true });
  for (const d of deptNodes) height(d);
  // 좌우로 나누기: 순서는 지키고, 더 짧은 쪽에 붙인다 (부서 하나만이면 오른쪽)
  const side = { 1: [], [-1]: [] };
  const tall = { 1: 0, [-1]: 0 };
  for (const d of deptNodes) {
    const s = deptNodes.length === 1 || tall[1] <= tall[-1] ? 1 : -1;
    side[s].push(d);
    tall[s] += d.H + DEPT_GAP;
  }
  for (const s of [1, -1]) {
    const list = side[s];
    const total = list.reduce((a, d) => a + d.H, 0) + DEPT_GAP * Math.max(0, list.length - 1);
    let top = -total / 2;
    for (const d of list) {
      place(d, s * GAP_X.chief, top, s, [0, 0]);
      top += d.H + DEPT_GAP;
    }
  }
  // 연계 선: 바깥 일 ↔ 작업 카드·공정. 둘 다 펼쳐져 있고 같은 쪽에 있을 때만, 바깥쪽으로 휘는 호로
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    for (const t of n.links ?? []) {
      const m = byId.get(t);
      if (!m || m.side !== n.side) continue;
      const ax = n.side === 1 ? n.x + n.w : n.x, bx = m.side === 1 ? m.x + m.w : m.x;
      const from = [ax, n.y + n.h / 2], to = [bx, m.y + m.h / 2];
      const len = Math.abs(to[1] - from[1]) * 1.4 + Math.abs(bx - ax) + 80;
      edges.push({ id: `l:${n.id}>${t}`, from, to, d: arc(from, to, n.side), len, dur: len / SPEED, kind: 'link', live: n.live || m.live, focus: n.focus || m.focus });
    }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  return { nodes, edges, bounds: { x0, y0, x1, y1 } };
}

// 같은 쪽 두 노드를 바깥으로 휘어 잇는 호 (위아래로 쌓인 카드끼리)
export function arc([ax, ay], [bx, by], side) {
  const out = side * (46 + Math.abs(by - ay) * 0.18);
  const ox = side === 1 ? Math.max(ax, bx) : Math.min(ax, bx);
  return `M${ax},${ay} C${ox + out},${ay} ${ox + out},${by} ${bx},${by}`;
}

// 가로로 뻗는 부드러운 곡선
export function curve([ax, ay], [bx, by]) {
  const dx = (bx - ax) * 0.5;
  return `M${ax},${ay} C${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}`;
}
