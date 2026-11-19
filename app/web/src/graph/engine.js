// 그래프 엔진 — 옵시디언 그래프 보기의 실제 코드(publish.obsidian.md app.js·sim.js)에서 뽑은 수치를 따른다.
// 근거: 02_리서치/옵시디언_UI_정밀분석.md
//   점 크기   SYNAPSE BRAIN: 트리 깊이로 정한다 — 비서실장 30 → 부서 19 → 하위 13 → … 4.5 (연결이 많으면 최대 35% 더)
//             깊이가 없는 점은 옵시디언 그대로 max(8, min(3·√(연결+1), 30)). 화면에선 size·√배율
//   선        화면에서 항상 1px, 점 가장자리에서 시작·끝
//   이름표    글자 (14 + size/4)·√배율, 투명도 clamp(log2(배율) + 1 − fade, 0, 1)
//   마우스    올린 점 + 직접 이웃만 1, 나머지 0.2 — 매 프레임 10%씩 다가감
//   확대      휠 한 칸 ×1.5, 배율 1/128 ~ 8, 매 프레임 15%씩 따라감
//   힘        중심 0.1 · 반발 −1000(distanceMin 30) · 링크 거리 250 · 충돌 60(0.5) · 300틱에 식음
// SYNAPSE BRAIN 쪽 차이: 이름표는 평소 반투명(최대 0.55), 마우스를 올린 점·이웃에서만 진하게.
import { Application, Container, Graphics, Sprite, Texture, Text } from 'pixi.js';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY, forceRadial } from 'd3-force';
import { quadtree } from 'd3-quadtree';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FADE = 0.2;           // 마우스를 올렸을 때 나머지의 알파
const LABEL_MAX_PX = 15;   // 이름표 최대 화면 크기(px)
const LABEL_REST = 0.55;    // 평소 이름표 최대 진하기 (반투명)

let CIRCLE = null;
function circleTexture() {
  if (CIRCLE) return CIRCLE;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(128, 128, 126, 0, TAU); g.fill();
  CIRCLE = Texture.from(c);
  return CIRCLE;
}

export const DEFAULTS = {
  // Display (옵시디언 기본: 화살표 끔, 노드 크기 1, 선 두께 1)
  arrows: false, textFade: 0, nodeSize: 1, linkThickness: 1,
  // Forces (슬라이더 눈금은 옵시디언 설정 패널과 같게)
  center: 0.5, repel: 10, linkForce: 1, linkDistance: 250,
  // 퍼지기: 비서실장을 가운데 고정하고, 깊이마다 고리를 두어 바깥으로 퍼지게 한다
  radial: true,
};

// 깊이별 점 크기 (비서실장 0, 부서 1, 하위 항목 2, 작업·참고 폴더 3, …)
const DEPTH_SIZE = [30, 19, 13, 9.5, 7.5, 6, 5, 4.5];
// 깊이별 이름표 덤: 멀리서도 위쪽 단계 이름은 보이게
const DEPTH_TEXT = [3, 2.5, 1.5, 0.6];
// 참고 문서·폴더(옵시디언식 지식 점): 업무 구조보다 훨씬 작게, 충분히 확대해야 보이고 이름은 더 확대해야 나온다
const KNOW_SIZE = { 참고: 1.4, 폴더: 2.4 };
const KNOW_TEXT = { 참고: -1.6, 폴더: -0.9 };          // 이름표 거리 덤 (음수 = 더 확대해야)
const isKnow = (n) => n.type === '참고' || n.type === '폴더';
// 지식 점의 진하기: 멀리서는 거의 안 보이고 확대하면 또렷해진다
const knowAlpha = (k) => clamp(Math.log2(k) + 1.6, 0.12, 1);

export async function createGraph(host, { colors, onOpen, onHover, settings = {}, compact = false }) {
  const app = new Application();
  await app.init({ resizeTo: host, backgroundAlpha: 0, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, preference: 'webgl' });
  host.appendChild(app.canvas);
  const canvas = app.canvas;
  const tex = circleTexture();

  let C = colors;
  let S = { ...DEFAULTS, ...settings };
  let onFps = null;
  const world = new Container();
  const lines = new Graphics();
  const linesHl = new Graphics();
  const nodeLayer = new Container();
  const ring = new Graphics();
  const labelLayer = new Container();
  // 고른 점(오른쪽 패널에 열린 문서): 뒤에서 번지는 빛 + 연결선을 따라 흐르는 시냅스
  const halo = new Sprite(tex);
  halo.anchor.set(0.5);
  halo.blendMode = 'add';
  halo.visible = false;
  const synapse = new Graphics();
  synapse.blendMode = 'add';
  world.addChild(halo, lines, linesHl, synapse, nodeLayer, ring, labelLayer);
  app.stage.addChild(world);

  let nodes = [];
  let links = [];
  const byId = new Map();
  let adj = new Map();
  let hover = null;
  let focus = null;           // 지금 열린 문서 (로컬 그래프 가운데)
  let tree = null;
  let shape = '';
  const cam = { x: 0, y: 0, k: 1, tx: 0, ty: 0, tk: 1 };
  let userMoved = false;
  let needFit = false;
  let settledFit = false;
  let reveal = null;          // Animate: 만들어진 순서대로 하나씩
  let marks = new Set();       // 기억 질문의 근거로 표시할 점
  let sel = null;             // 고른 점 (오른쪽 패널에 열린 문서)
  let selId = null;
  let clock = 0;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sim = forceSimulation().alphaDecay(1 - 0.001 ** (1 / 300)).velocityDecay(0.4).stop();
  const count = new Map();
  function applyForces() {
    count.clear();
    for (const l of links) {
      const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
      count.set(s, (count.get(s) ?? 0) + 1); count.set(t, (count.get(t) ?? 0) + 1);
    }
    const cnt = (n) => count.get(n.id ?? n) ?? 1;
    sim
      .force('center-x', forceX(0).strength(S.center * (S.radial ? 0.02 : 0.2)))
      .force('center-y', forceY(0).strength(S.center * (S.radial ? 0.02 : 0.2)))
      // 슬라이더 눈금은 옵시디언과 같고(반발 10 · 거리 250), 실제 힘은 덩어리가 보이도록 맞춘 배율
      .force('repel', forceManyBody().strength(-S.repel * 32).distanceMin(30).distanceMax(1400))
      // 퍼지기에선 트리 선이 모양을 잡고, 가지를 건너는 링크(시냅스)는 살짝만 당긴다
      .force('link', forceLink(links).id((n) => n.id).distance((l) => (S.radial && l.kind === 'tree' ? Math.max(40, Math.abs(ringOf(l.target) - ringOf(l.source))) : S.linkDistance * 0.36)).strength((l) => S.linkForce * Math.min(1, 1.6 / Math.min(cnt(l.source), cnt(l.target))) * (S.radial && l.kind !== 'tree' ? 0.06 : 1)))
      .force('collide', forceCollide((n) => n.r + 10).strength(0.5))
      .force('radial', S.radial ? forceRadial((n) => ringOf(n)).strength(0.5) : null);
    // 가운데(깊이 0)는 고정
    for (const n of nodes) {
      if (S.radial && n.depth === 0) { n.fx = 0; n.fy = 0; } else if (n.depth === 0) { n.fx = null; n.fy = null; }
    }
  }

  // 깊이마다 고리 반지름: 안쪽 원의 넓이가 그 깊이까지의 점 수에 비례하게 (√누적) — 가운데가 뭉치지 않고 고르게 퍼진다.
  // 한 단계는 최소 한 칸(선 거리 슬라이더에 맞춤)
  let rings = [0];
  function makeRings(list) {
    const cnt = [];
    for (const n of list) { const d = n.depth ?? 4; cnt[d] = (cnt[d] ?? 0) + 1; }
    const step = Math.max(90, S.linkDistance * 0.44);
    const k = S.linkDistance * 0.2;
    rings = [0];
    let sum = cnt[0] ?? 0;
    for (let d = 1; d < cnt.length; d++) { sum += cnt[d] ?? 0; rings[d] = Math.max(rings[d - 1] + step, k * Math.sqrt(sum)); }
  }
  const ringOf = (n) => rings[n.depth ?? 4] ?? rings.at(-1);

  // 처음 놓을 자리: 트리 선(tree)을 따라 가지마다 잎 수만큼 부채꼴을 나눠 고리 위에 펼친다
  function radialSeed(data) {
    const kids = new Map();
    const child = new Set();
    for (const l of data.links) if (l.kind === 'tree') { (kids.get(l.source) ?? kids.set(l.source, []).get(l.source)).push(l.target); child.add(l.target); }
    const leaves = new Map();
    const count = (id, g = 0) => {
      if (leaves.has(id)) return leaves.get(id);
      const c = g > 40 ? 1 : (kids.get(id) ?? []).reduce((sum, k) => sum + count(k, g + 1), 0) || 1;
      leaves.set(id, c);
      return c;
    };
    const depthOf = new Map(data.nodes.map((n) => [n.id, n.depth ?? 4]));
    const pos = new Map();
    const place = (id, a0, a1, g = 0) => {
      const mid = (a0 + a1) / 2;
      const r = rings[depthOf.get(id)] ?? rings.at(-1);
      pos.set(id, { x: Math.cos(mid) * r, y: Math.sin(mid) * r });
      if (g > 40) return;
      let a = a0;
      const total = (kids.get(id) ?? []).reduce((sum, k) => sum + count(k), 0) || 1;
      for (const k of kids.get(id) ?? []) { const w = ((a1 - a0) * count(k)) / total; place(k, a, a + w, g + 1); a += w; }
    };
    const roots = data.nodes.filter((n) => !child.has(n.id) && kids.has(n.id));
    const all = roots.reduce((sum, n) => sum + count(n.id), 0) || 1;
    let a = -Math.PI / 2;
    for (const n of roots) { const w = (TAU * count(n.id)) / all; place(n.id, a, a + w); a += w; }
    return pos;
  }

  // 깊이가 있으면 깊이로, 없으면 옵시디언 getSize: max(8, min(3·√(연결+1), 30))
  const size = (n) => S.nodeSize * (isKnow(n) ? KNOW_SIZE[n.type] * (1 + Math.min(0.4, Math.sqrt(n.degree) / 16)) : n.depth == null
    ? Math.max(8, Math.min(3 * Math.sqrt(n.degree + 1), 30))
    : DEPTH_SIZE[Math.min(n.depth, DEPTH_SIZE.length - 1)] * (1 + Math.min(0.35, Math.sqrt(n.degree) / 24)));

  function nodeColor(n) {
    if (n === hover) return C.accent;
    if (n === focus) return C.focus;
    if (n.type === '유령') return C.ghost;
    if (n.type === '태그') return C.tag;
    return n.group ?? C.node;
  }

  function makeNode(n) {
    n.sprite = new Sprite(tex);
    n.sprite.anchor.set(0.5);
    nodeLayer.addChild(n.sprite);
    n.a = 0; n.la = 0; n.shown = 1; n.slide = 0;   // 처음엔 0에서 서서히 나타난다 (옵시디언과 같음)
  }

  // 이름표: 평소엔 짧게 한 줄(…), 마우스를 올린 점만 긴 제목을 줄바꿈해서
  const cut = (t, n) => ([...t].length > n ? `${[...t].slice(0, n - 1).join('').trimEnd()}…` : t);
  const shortTitle = (t) => cut(t, compact ? 18 : 26);
  const fullTitle = (t) => cut(t, compact ? 60 : 120);
  function makeLabel(n) {
    n.label = new Text({
      text: shortTitle(n.title), resolution: 2,
      style: { fontFamily: 'Pretendard Variable, Geist, ui-sans-serif, system-ui, sans-serif', fontSize: 14 + n.r / 4, fontWeight: '500', fill: C.text, align: 'center', wordWrap: false, wordWrapWidth: compact ? 160 : 260 },
    });
    n.label.anchor.set(0.5, 0);
    n.labelStrong = false;
    n.labelFull = false;
    labelLayer.addChild(n.label);
  }

  function setData(data, opts = {}) {
    const old = new Map(byId);
    const next = [];
    makeRings(data.nodes);
    const seed = S.radial ? radialSeed(data) : null;
    const nbOf = new Map();
    for (const l of data.links) { if (!nbOf.has(l.source)) nbOf.set(l.source, l.target); if (!nbOf.has(l.target)) nbOf.set(l.target, l.source); }
    for (const d of data.nodes) {
      let n = old.get(d.id);
      if (!n) {
        n = { ...d };
        const at = seed?.get(d.id);
        const other = byId.get(nbOf.get(d.id)) ?? (seed && seed.get(nbOf.get(d.id)));
        const j = () => (Math.random() - 0.5) * 30;
        n.x = at ? at.x + j() : other ? other.x + j() * 2 : (Math.random() - 0.5) * 900;
        n.y = at ? at.y + j() : other ? other.y + j() * 2 : (Math.random() - 0.5) * 900;
        makeNode(n);
      } else {
        const titleChanged = n.title !== d.title;
        Object.assign(n, d);
        if (titleChanged && n.label) { n.label.destroy(); n.label = null; }
      }
      const r = size(n);
      if (n.label && n.r !== r) { n.label.destroy(); n.label = null; }
      n.r = r;
      next.push(n);
      old.delete(d.id);
    }
    for (const n of old.values()) { n.sprite.destroy(); n.label?.destroy(); }
    byId.clear();
    for (const n of next) byId.set(n.id, n);
    nodes = next;
    links = data.links.filter((l) => byId.has(l.source) && byId.has(l.target)).map((l) => ({ ...l }));
    adj = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const l of links) { adj.get(l.source).add(l.target); adj.get(l.target).add(l.source); }
    focus = opts.focus ? byId.get(opts.focus) ?? null : null;
    sel = selId ? byId.get(selId) ?? null : null;

    sim.nodes(nodes);
    applyForces();
    const nextShape = `${nodes.length}|${links.length}|${nodes.map((n) => n.id).join(',')}`;
    if (nextShape !== shape) {
      const first = !shape;
      shape = nextShape;
      if (first) { sim.alpha(1); for (let i = 0, end = nodes.length > 600 ? 120 : 300; i < end; i++) sim.tick(); needFit = true; settledFit = false; }
      else sim.alpha(0.3);
    }
    tree = null;
  }

  function setSettings(next) {
    const prev = S;
    S = { ...S, ...next };
    if (prev.nodeSize !== S.nodeSize) for (const n of nodes) { n.r = size(n); if (n.label) { n.label.destroy(); n.label = null; } }
    if (['center', 'repel', 'linkForce', 'linkDistance', 'nodeSize', 'radial'].some((k) => prev[k] !== S[k])) { makeRings(nodes); applyForces(); sim.alpha(0.3); }
  }

  function setColors(c) {
    C = c;
    for (const n of nodes) { if (n.label) { n.label.destroy(); n.label = null; } }
  }

  // Animate: 만들어진 순서대로 점이 하나씩 생기며 그래프가 자란다
  function animate() {
    const order = [...nodes].sort((a, b) => String(a.created ?? '').localeCompare(String(b.created ?? '')));
    for (const n of nodes) n.shown = 0;
    reveal = { order, i: 0, t: 0, every: Math.max(0.02, Math.min(0.12, 6 / order.length)) };
    for (const n of order) { n.x = (Math.random() - 0.5) * 80; n.y = (Math.random() - 0.5) * 80; n.vx = 0; n.vy = 0; }
    sim.alpha(1);
    userMoved = false; settledFit = false;
  }

  // ── 카메라
  function fit(instant = false, pad = 70, maxK = compact ? 1.2 : 1.6) {
    const list = nodes.filter((n) => n.shown > 0.5);
    if (!list.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
    const W = host.clientWidth || app.screen.width, H = host.clientHeight || app.screen.height;
    const k = clamp(Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0)), 1 / 128, maxK);
    cam.tk = k; cam.tx = W / 2 - ((x0 + x1) / 2) * k; cam.ty = H / 2 - ((y0 + y1) / 2) * k;
    if (instant) Object.assign(cam, { k: cam.tk, x: cam.tx, y: cam.ty });
  }
  const ro = new ResizeObserver(() => { if (!userMoved) needFit = true; });
  ro.observe(host);
  const toWorld = (sx, sy) => ({ x: (sx - cam.x) / cam.k, y: (sy - cam.y) / cam.k });

  // ── 입력: 휠 한 칸 ×1.5, 빈 곳 끌기 = 이동, 점 끌기 = 점 옮기기, 클릭 = 열기
  let drag = null;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pick = (sx, sy) => {
    if (!tree) return null;
    const w = toWorld(sx, sy);
    const n = tree.find(w.x, w.y, 80 / cam.k + 40);
    if (!n || n.shown < 0.5) return null;
    const screenR = n.r * Math.sqrt(cam.k);
    return Math.hypot(n.x - w.x, n.y - w.y) * cam.k <= Math.max(screenR, 6) + 3 ? n : null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    userMoved = true;
    const { x, y } = local(e);
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    const k = clamp(cam.tk * 1.5 ** (-(e.deltaY * unit) / 120), 1 / 128, 8);
    const wx = (x - cam.tx) / cam.tk, wy = (y - cam.ty) / cam.tk;
    cam.tk = k; cam.tx = x - wx * k; cam.ty = y - wy * k;
  };
  const onDown = (e) => {
    const p = local(e);
    const n = pick(p.x, p.y);
    drag = { sx: p.x, sy: p.y, cx: cam.tx, cy: cam.ty, node: n, moved: false };
    if (n) { n.fx = n.x; n.fy = n.y; }
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('grabbing');
  };
  const onMove = (e) => {
    const p = local(e);
    if (drag) {
      if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 3) drag.moved = true;
      if (drag.node) {
        const w = toWorld(p.x, p.y);
        drag.node.fx = w.x; drag.node.fy = w.y;
        sim.alphaTarget(0.3);
        if (sim.alpha() < 0.3) sim.alpha(0.3);
      } else {
        cam.tx = drag.cx + (p.x - drag.sx); cam.ty = drag.cy + (p.y - drag.sy);
        cam.x = cam.tx; cam.y = cam.ty;
        userMoved = true;
      }
      return;
    }
    const n = pick(p.x, p.y);
    if (n !== hover) { hover = n; canvas.classList.toggle('pointer', !!n); }
    onHover?.(n ? { node: n, x: p.x, y: p.y, ctrl: e.ctrlKey || e.metaKey } : null);
  };
  const onUp = (e) => {
    canvas.classList.remove('grabbing');
    if (!drag) return;
    if (drag.node) { drag.node.fx = null; drag.node.fy = null; sim.alphaTarget(0); }
    if (!drag.moved && drag.node) onOpen?.(drag.node, e);
    drag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* 이미 놓음 */ }
  };
  const onLeave = () => { hover = null; onHover?.(null); };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onLeave);

  // ── 선: 화면 1px, 점 가장자리에서 가장자리까지
  function drawLines(k, ns) {
    const w = Math.max(0.5, S.linkThickness) / k;
    lines.clear(); linesHl.clear();
    for (const l of links) {
      const s = l.source, t = l.target;
      const vis = Math.min(s.shown, t.shown);
      if (vis < 0.05) continue;
      const on = (hover && (s === hover || t === hover)) || (sel && !hover && (s === sel || t === sel));
      const a = Math.min(s.a, t.a) * vis * (isKnow(s) || isKnow(t) ? knowAlpha(k) * 0.6 : 1);
      const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy) || 1;
      const rs = s.r * ns, rt = t.r * ns;
      if (d <= rs + rt) continue;
      const ux = dx / d, uy = dy / d;
      const x0 = s.x + ux * rs, y0 = s.y + uy * rs, x1 = t.x - ux * rt, y1 = t.y - uy * rt;
      const g = on ? linesHl : lines;
      const color = on ? C.accent : C.line;
      const alpha = on ? 1 : a;
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: w, color, alpha });
      if (S.arrows) {
        const sz = (2 * Math.sqrt(Math.max(0.5, S.linkThickness))) / k;
        const aa = alpha * clamp((k - 0.3) * 2, 0, 1);
        if (aa > 0.02) {
          const px = -uy, py = ux;
          g.poly([x1, y1, x1 - ux * 4 * sz + px * 2 * sz, y1 - uy * 4 * sz + py * 2 * sz, x1 - ux * 3 * sz, y1 - uy * 3 * sz, x1 - ux * 4 * sz - px * 2 * sz, y1 - uy * 4 * sz - py * 2 * sz]).fill({ color, alpha: aa });
        }
      }
    }
  }

  // ── 고른 점: 숨쉬는 빛 + 번지는 고리 두 겹 + 이웃으로 흐르는 시냅스 (동작 줄이기면 빛만, 멈춘 채)
  const SYN_SPEED = 260;   // 화면 px/초
  function drawSelected(k, ns) {
    synapse.clear();
    if (!sel || !sel.shown) { halo.visible = false; return; }
    const r = sel.r * ns;
    const breathe = calm ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 2.4);
    halo.visible = true;
    halo.position.set(sel.x, sel.y);
    halo.tint = C.accent;
    halo.width = halo.height = Math.max(r * (5 + breathe * 1.6), 46 / k);
    halo.alpha = 0.22 + breathe * 0.18;
    // 고리: 점 둘레 굵은 고리 + 바깥으로 번지며 사라지는 고리
    const th = 1.6 / k;
    ring.circle(sel.x, sel.y, r + 3 / k).stroke({ width: th * 1.4, color: C.accent, alpha: 0.95 });
    if (!calm) {
      for (const off of [0, 0.5]) {
        const p = (clock * 0.55 + off) % 1;
        ring.circle(sel.x, sel.y, r + 3 / k + p * Math.max(r * 2.2, 34 / k)).stroke({ width: th, color: C.accent, alpha: (1 - p) * 0.7 });
      }
    }
    if (calm) return;
    // 시냅스: 이웃마다 빛 점 둘 — 고른 점에서 나가고, 하나는 들어온다 (선이 많으면 앞 48개만)
    const nb = adj.get(sel.id);
    if (!nb) return;
    let i = 0;
    for (const id of nb) {
      if (i++ >= 48) break;
      const m = byId.get(id);
      if (!m || m.shown < 0.5) continue;
      const dx = m.x - sel.x, dy = m.y - sel.y, d = Math.hypot(dx, dy) || 1;
      const dur = Math.max(0.6, (d * k) / SYN_SPEED);
      const phase = (id.length * 0.137) % 1;   // 이웃마다 엇갈리게
      for (const [dir, off] of [[1, 0], [-1, 0.5]]) {
        let p = (clock / dur + phase + off) % 1;
        if (dir < 0) p = 1 - p;
        const x = sel.x + dx * p, y = sel.y + dy * p;
        const fade = Math.sin(Math.PI * p);           // 양 끝에서 흐려진다
        synapse.circle(x, y, 5 / k).fill({ color: C.accent, alpha: 0.18 * fade });
        synapse.circle(x, y, 2.2 / k).fill({ color: C.accent, alpha: 0.95 * fade });
      }
    }
  }

  // ── 매 프레임
  let fpsAcc = 0, fpsN = 0;
  app.ticker.add((tk) => {
    const dt = Math.min(0.05, tk.deltaMS / 1000);
    clock += dt;
    if (reveal) {
      reveal.t += dt;
      while (reveal.t >= reveal.every && reveal.i < reveal.order.length) {
        reveal.t -= reveal.every;
        const n = reveal.order[reveal.i++];
        n.shown = 0.001;
        const nb = [...(adj.get(n.id) ?? [])].map((id) => byId.get(id)).find((m) => m.shown > 0.5);
        if (nb) { n.x = nb.x + (Math.random() - 0.5) * 30; n.y = nb.y + (Math.random() - 0.5) * 30; }
        sim.alpha(Math.max(sim.alpha(), 0.35));
      }
      if (reveal.i >= reveal.order.length) reveal = null;
      if (!userMoved) { const k0 = cam.tk; fit(false, 90, 0.9); if (reveal && cam.tk > k0 && reveal.i > 3) cam.tk = k0; }
    }
    if (sim.alpha() > sim.alphaMin()) { sim.tick(); tree = null; }
    if (!tree) tree = quadtree(nodes, (n) => n.x, (n) => n.y);
    if (needFit && host.clientWidth > 0 && nodes.length) { needFit = false; fit(true); }
    if (!settledFit && sim.alpha() < 0.05) { settledFit = true; if (!userMoved && !reveal) fit(); }

    // 카메라: 매 프레임 15%씩 목표로
    cam.k = lerp(cam.k, cam.tk, 0.15); cam.x = lerp(cam.x, cam.tx, 0.15); cam.y = lerp(cam.y, cam.ty, 0.15);
    world.scale.set(cam.k); world.position.set(cam.x, cam.y);

    const k = cam.k;
    const ns = Math.sqrt(k) / k;                    // nodeScale: 화면 크기 = 지도 크기 × √배율
    const lead = hover ?? sel;                     // 마우스가 없으면 고른 점과 이웃을 밝힌다
    const hl = lead ? adj.get(lead.id) ?? new Set() : null;
    const textAlpha = clamp(Math.log2(k) + 1 - S.textFade, 0, 1);
    const kAlpha = knowAlpha(k);
    ring.clear();
    for (const n of nodes) {
      if (n.shown > 0 && n.shown < 1) n.shown = Math.min(1, n.shown + dt * 3);
      const near = !lead || n === lead || hl.has(n.id);
      n.a = lerp(n.a, n.shown * (near ? 1 : FADE), 0.1);   // 매 프레임 10%씩
      const s = n.sprite;
      s.position.set(n.x, n.y);
      s.width = s.height = n.r * ns * 2;
      s.tint = nodeColor(n);
      s.alpha = n.a * (n.type === '유령' ? 0.5 : 1) * (isKnow(n) && n !== hover && n !== focus ? kAlpha : 1);
      s.visible = n.shown > 0;
      if (n === hover || n === focus) {
        const th = Math.max(1, 1 / k / ns) * ns;
        ring.circle(n.x, n.y, n.r * ns + th / 2).stroke({ width: th * 1.5, color: C.focus, alpha: n.a });
      } else if (marks.has(n.id)) {
        // 기억 질문의 근거 문서: 멀리서도 보이게 화면 기준 크기의 고리
        const rr = Math.max(n.r * ns * 1.8, 9 / k);
        ring.circle(n.x, n.y, rr).stroke({ width: 1.5 / k, color: C.accent, alpha: 0.95 });
      }

      // 이름표: 평소엔 반투명, 마우스를 올린 점은 진하게 고정·조금 아래로, 이웃은 진하게
      const strong = n === hover || n === focus || n === sel;
      const neighbor = !!(hl && hl.has(n.id) && !strong);
      const ta = isKnow(n) ? clamp(Math.log2(k) + 1 - S.textFade + KNOW_TEXT[n.type], 0, 1)
        : n.depth != null && n.depth < DEPTH_TEXT.length ? clamp(Math.log2(k) + 1 - S.textFade + DEPTH_TEXT[n.depth], 0, 1) : textAlpha;
      const want = strong ? 1 : neighbor ? Math.max(0.9, ta) : ta * LABEL_REST * (lead ? FADE : 1);
      n.la = lerp(n.la, want * n.shown, 0.1);
      n.slide = lerp(n.slide, n === hover ? 15 : 0, 0.15);
      if (n.la > 0.02 && n.shown > 0.5) {
        if (!n.label) makeLabel(n);
        n.label.visible = true;
        n.label.alpha = Math.min(1, n.la);
        const full = n === hover;
        if (n.labelFull !== full) { n.labelFull = full; n.label.style.wordWrap = full; n.label.text = full ? fullTitle(n.title) : shortTitle(n.title); }
        let sc = (n === hover && k < 1 ? 1 / k : ns) * (compact ? 0.85 : 1);   // 멀리서도 올린 점 이름은 읽히게
        const px = n.label.style.fontSize * sc * k;                            // 화면에 그려지는 글자 크기
        if (px > LABEL_MAX_PX) sc *= LABEL_MAX_PX / px;                        // 확대해도 글자는 이 이상 커지지 않는다
        n.label.scale.set(sc);
        n.label.position.set(n.x, n.y + (n.r + 5) * ns + n.slide * ns);
        const hi = strong || neighbor;
        if (n.labelStrong !== hi) { n.labelStrong = hi; n.label.style.fill = hi ? C.textStrong : C.text; }
      } else if (n.label) n.label.visible = false;
    }
    drawLines(k, ns);
    drawSelected(k, ns);

    fpsAcc += app.ticker.FPS; fpsN++;
    if (fpsN >= 30) { onFps?.(Math.round(fpsAcc / fpsN)); fpsAcc = 0; fpsN = 0; }
  });

  return {
    setData, setSettings, setColors, animate,
    // 표시할 점(기억 질문의 근거) — 고리를 두르고, 하나 이상이면 그쪽으로 카메라를 옮긴다
    setMarks: (ids) => {
      marks = new Set(ids ?? []);
      const pts = nodes.filter((n) => marks.has(n.id));
      if (pts.length) {
        const x0 = Math.min(...pts.map((n) => n.x)), x1 = Math.max(...pts.map((n) => n.x));
        const y0 = Math.min(...pts.map((n) => n.y)), y1 = Math.max(...pts.map((n) => n.y));
        const W = host.clientWidth, H = host.clientHeight;
        const kk = clamp(Math.min((W - 240) / Math.max(200, x1 - x0), (H - 240) / Math.max(200, y1 - y0)), 0.08, 1.4);
        cam.tk = kk; cam.tx = W / 2 - ((x0 + x1) / 2) * kk; cam.ty = H / 2 - ((y0 + y1) / 2) * kk;
        userMoved = true;
      }
    },
    // 고른 점 (오른쪽 패널의 문서 id) — 없으면 효과를 끈다
    setSelected: (id) => { selId = id ?? null; sel = selId ? byId.get(selId) ?? null : null; },
    fit: () => { userMoved = false; fit(); },
    onFps: (fn) => { onFps = fn; },
    // 다른 탭(한눈에·기억 카드)이 그래프를 덮는 동안은 그리기를 멈춘다
    pause: (on) => { if (on) app.ticker.stop(); else app.ticker.start(); },
    destroy: () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      sim.stop();
      app.destroy(true, { children: true, texture: false });
    },
  };
}
