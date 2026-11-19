// 서버 그래프 → 엔진 데이터. 검색 문법·색 그룹·로컬 그래프(깊이·링크 방향) — 옵시디언 그래프 설정과 같은 항목
import { STATUS, linkTarget } from '../util.js';

export const FILTER_DEFAULTS = { search: '', tags: false, ghosts: true, orphans: true };
export const LOCAL_DEFAULTS = { depth: 1, incoming: true, outgoing: true, neighbors: true };

const hexOf = (v) => (v ? parseInt(String(v).replace('#', '').slice(0, 6), 16) : null);

// ── 검색 문법 (옵시디언 검색과 같은 모양)
//   글자              제목·ID·경로·부서에 포함
//   path:작업/        파일 경로      file:W-2610  파일 이름(ID)
//   tag:영상          태그           dept:리서치부  부서
//   status:running    실행 중  ·  status:decision 결정 필요  ·  status:검수 / 완료 / 예약 …
//   type:결정         문서 종류
//   -낱말             빼기          A OR B      둘 중 하나
//   "띄어 쓴 말"       한 덩어리로
function tokens(q) {
  return [...q.matchAll(/(-?)(\w+:)?("([^"]*)"|\S+)/gu)].map((m) => ({
    neg: m[1] === '-',
    key: m[2] ? m[2].slice(0, -1).toLowerCase() : null,
    val: (m[4] ?? m[3]).replace(/^"|"$/g, '').toLowerCase().replace(/^#/, m[2] === 'tag:' ? '' : '#'),
  })).filter((t) => t.val && t.val !== '#');
}

function termMatch(n, t) {
  const v = t.val;
  const has = (s) => String(s ?? '').toLowerCase().includes(v);
  switch (t.key) {
    case 'path': return has(n.file);
    case 'file': return has(n.id);
    case 'tag': return (n.tags ?? []).some((x) => String(x).toLowerCase().startsWith(v));
    case 'dept': return has(n.dept);
    case 'type': return has(n.type);
    case 'status': {
      if (v === 'running') return !!n.live;
      if (v === 'decision') return !!n.deciding;
      return has(n.status) || has(STATUS[n.status]?.label);
    }
    default: return has(n.title) || has(n.id) || has(n.file) || has(n.dept);
  }
}

export function compileQuery(q) {
  const text = String(q ?? '').trim();
  if (!text) return () => true;
  const alts = text.split(/\s+OR\s+/).map(tokens).filter((a) => a.length);
  if (!alts.length) return () => true;
  return (n) => alts.some((terms) => terms.every((t) => termMatch(n, t) !== t.neg));
}

// ── 색 그룹: 위에서부터 처음 맞는 그룹 색 (옵시디언 Groups와 같은 규칙)
export function defaultGroups(state) {
  return [
    { id: 'g-live', query: 'status:running', color: 'accent', on: true },
    { id: 'g-decide', query: 'status:decision', color: 'warn', on: true },
    ...state.depts.map((d) => ({ id: `g-${d.name}`, query: `dept:${d.name}`, color: d.color, on: true })),
  ];
}
export const groupColor = (g, colors) => (g.color === 'accent' ? colors.accent : g.color === 'warn' ? colors.warn : hexOf(g.color));
export const groupCss = (g) => (g.color === 'accent' ? 'var(--accent)' : g.color === 'warn' ? 'var(--warn)' : g.color);

export function buildData(graph, state, { filters = FILTER_DEFAULTS, groups = [], colors }) {
  const tasks = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
  const pending = new Set(state.pending.map((p) => linkTarget(p.task)));
  const rich = graph.nodes.map((n) => {
    const t = n.type === '작업' ? tasks[n.id] : null;
    return {
      ...n,
      live: t?.runtime?.phase === '실행',
      deciding: (n.type === '작업' && pending.has(n.id)) || (n.type === '결정' && n.status === '대기'),
      line: t?.runtime?.lastText ?? '',
    };
  });
  const match = compileQuery(filters.search);
  const compiled = groups.filter((g) => g.on && g.query.trim()).map((g) => ({ test: compileQuery(g.query), color: groupColor(g, colors) }));

  let nodes = rich.filter((n) => {
    if (n.type === '태그' && !filters.tags) return false;
    if (n.type === '유령' && !filters.ghosts) return false;
    return match(n);
  });
  let ids = new Set(nodes.map((n) => n.id));
  const links = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  if (!filters.orphans) {
    const linked = new Set(links.flatMap((l) => [l.source, l.target]));
    nodes = nodes.filter((n) => linked.has(n.id));
    ids = new Set(nodes.map((n) => n.id));
  }
  return {
    nodes: nodes.map((n) => ({
      id: n.id, title: n.title, type: n.type, dept: n.dept, status: n.status, degree: n.degree, depth: n.depth, tags: n.tags,
      created: n.created, file: n.file, bytes: n.bytes, live: n.live, deciding: n.deciding, line: n.line,
      group: compiled.find((g) => g.test(n))?.color ?? null,
    })),
    links: links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ source: l.source, target: l.target, kind: l.kind })),
  };
}

// ── 로컬 그래프: 가운데 문서에서 depth 단계까지. 들어오는/나가는 링크를 따라갈지, 이웃끼리 링크를 보일지
export function localData(data, center, { depth = 1, incoming = true, outgoing = true, neighbors = true } = {}) {
  const out = new Map(), inn = new Map();
  for (const l of data.links) {
    (out.get(l.source) ?? out.set(l.source, []).get(l.source)).push(l);
    (inn.get(l.target) ?? inn.set(l.target, []).get(l.target)).push(l);
  }
  const keep = new Set([center]);
  const walked = new Set();
  let frontier = [center];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      const steps = [
        ...(outgoing ? (out.get(id) ?? []).map((l) => [l, l.target]) : []),
        ...(incoming ? (inn.get(id) ?? []).map((l) => [l, l.source]) : []),
      ];
      for (const [l, nb] of steps) {
        walked.add(l);
        if (!keep.has(nb)) { keep.add(nb); next.push(nb); }
      }
    }
    frontier = next;
  }
  return {
    nodes: data.nodes.filter((n) => keep.has(n.id)),
    links: data.links.filter((l) => keep.has(l.source) && keep.has(l.target) && (neighbors || walked.has(l))),
  };
}

// CSS 변수 → 그래프 색 (테마가 바뀌면 다시 읽는다)
// CSS 색(oklch 포함) → #rrggbb. WebGL은 oklch를 못 읽어서 캔버스에 한 점 칠해 읽는다
const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d', { willReadFrequently: true }) : null;
function cssHex(color) {
  if (!probe || !color) return '#888888';
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cssHex(cs.getPropertyValue(k).trim());
  const dark = document.documentElement.dataset.theme !== 'light';
  // 옵시디언 기본 테마 값 (02_리서치/옵시디언_UI_정밀분석.md): 노드 base-70, 없는 문서 base-50×0.5, 선 base-35, 태그 녹색.
  // 강조(마우스·지금 문서)는 SYNAPSE BRAIN 강조색을 쓴다.
  return {
    dark,
    accent: hexOf(v('--accent')), focus: hexOf(v('--accent')), warn: hexOf(v('--warn')),
    node: dark ? 0xb3b3b3 : 0x5c5c5c,
    ghost: dark ? 0x666666 : 0xababab,
    tag: dark ? 0x44cf6e : 0x2f9e5b,
    line: dark ? 0x3f3f3f : 0xdadada,
    text: v('--text-2'), textStrong: v('--text'),
  };
}
