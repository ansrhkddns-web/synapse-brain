// 화면 뒤의 신경망 — 실제 신경세포처럼:
//   · 망은 고정이다(크기마다 같은 씨앗으로 만든다). 세포체에서 가늘어지는 수상돌기, 이웃 세포로 휘어 가는 축삭.
//   · 신호(활동전위)는 축삭을 따라 이동하는 밝은 빛 조각이다. 닿으면 그 세포가 번쩍이고, 시냅스 틈에 전달물질이 흩어지며,
//     확률에 따라 다음 세포로 이어 발화한다(연쇄). 막 발화한 세포는 잠깐 쉰다(불응기).
//   · 부서 = 허브 세포(부서 색). 지금 일이 도는 부서의 허브는 박자 맞춰 발화해 연쇄를 일으킨다 — 일이 많을수록 망이 바쁘다.
//   · 정적인 망은 한 번만 그려 두고(오프스크린), 매 프레임엔 신호만 그린다. 화면이 안 보이면 멈춤, 움직임 줄이기면 망만.
import { useEffect, useRef } from 'react';

const SPEED = 170;   // 신호 속도 px/초 (모든 선이 같다)
const rgba = (hex, a) => {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const v = parseInt(n, 16);
  return Number.isNaN(v) ? `rgba(124,140,255,${a})` : `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
};
// 씨앗 난수 — 같은 크기면 같은 망
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// 휘어진 길을 점 목록으로 (조금씩 흔들려 손으로 그린 신경처럼)
function path(a, b, r, bend) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const c1 = { x: a.x + dx * 0.3 + nx * len * bend * (0.6 + r()), y: a.y + dy * 0.3 + ny * len * bend * (0.6 + r()) };
  const c2 = { x: a.x + dx * 0.7 - nx * len * bend * (0.4 + r() * 0.6), y: a.y + dy * 0.7 - ny * len * bend * (0.4 + r() * 0.6) };
  const n = Math.max(12, Math.round(len / 6));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, iu = 1 - u;
    const wob = Math.sin(u * Math.PI * 3 + r() * 0.4) * 1.2 * Math.sin(u * Math.PI);
    pts.push({ x: iu ** 3 * a.x + 3 * iu * iu * u * c1.x + 3 * iu * u * u * c2.x + u ** 3 * b.x + nx * wob, y: iu ** 3 * a.y + 3 * iu * iu * u * c1.y + 3 * iu * u * u * c2.y + u ** 3 * b.y + ny * wob });
  }
  return pts;
}

function build(w, h, depts, colors) {
  const r = rng(Math.round(w) * 7919 + Math.round(h) * 104729);
  const count = Math.max(26, Math.min(70, Math.round((w * h) / 26000)));
  const minD = Math.sqrt((w * h) / count) * 0.62;
  const cells = [];
  for (let tries = 0; cells.length < count && tries < count * 60; tries++) {
    const p = { x: 30 + r() * (w - 60), y: 30 + r() * (h - 60) };
    if (cells.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > minD)) cells.push({ ...p, r: 1.6 + r() * 1.2, hub: null, out: [], fire: -1e9, flash: 0 });
  }
  // 허브(부서): 서로 멀리 떨어진 세포를 고른다
  const hubs = [];
  for (const d of depts) {
    let best = null, bestD = -1;
    for (const c of cells) {
      if (c.hub) continue;
      const dd = hubs.length ? Math.min(...hubs.map((x) => Math.hypot(x.x - c.x, x.y - c.y))) : Math.hypot(c.x - w / 2, c.y - h / 2) * -1 + 1e6;
      if (dd > bestD) { bestD = dd; best = c; }
    }
    if (!best) break;
    best.hub = d.name; best.c = d.color || colors.g1; best.r = 3.6; hubs.push(best);
  }
  // 축삭: 가까운 이웃 2~3개와 잇는다 (허브는 더 많이)
  const edges = [];
  const has = new Set();
  cells.forEach((c, i) => {
    const near = cells.map((q, j) => [j, Math.hypot(q.x - c.x, q.y - c.y)]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]);
    const k = c.hub ? 4 : 2 + (r() < 0.4 ? 1 : 0);
    for (const [j, d] of near.slice(0, k)) {
      if (d > minD * 2.6) continue;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (has.has(key)) continue;
      has.add(key);
      const pts = path(c, cells[j], r, (r() - 0.5) * 0.5);
      let L = 0; for (let m = 1; m < pts.length; m++) L += Math.hypot(pts[m].x - pts[m - 1].x, pts[m].y - pts[m - 1].y);
      const e = { a: i, b: j, pts, L };
      edges.push(e); c.out.push(edges.length - 1); cells[j].out.push(edges.length - 1);
    }
  });
  // 수상돌기: 세포마다 짧게 갈라지는 가지 (끝이 열려 있다)
  const twigs = [];
  for (const c of cells) {
    const n = c.hub ? 5 : 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const a0 = r() * Math.PI * 2, L = (c.hub ? 26 : 14) + r() * (c.hub ? 30 : 18);
      const end = { x: c.x + Math.cos(a0) * L, y: c.y + Math.sin(a0) * L };
      const pts = path(c, end, r, (r() - 0.5) * 0.8);
      twigs.push({ pts, c: c.c });
      if (r() < 0.5) { // 한 번 더 갈라짐
        const m = pts[Math.floor(pts.length * 0.6)];
        const a1 = a0 + (r() - 0.5) * 1.4;
        twigs.push({ pts: path(m, { x: m.x + Math.cos(a1) * L * 0.5, y: m.y + Math.sin(a1) * L * 0.5 }, r, 0.2), c: c.c });
      }
    }
  }
  return { cells, edges, twigs, hubs };
}

export function SynapseField({ depts = [], sessions = [], off = false }) {
  const ref = useRef(null);
  const data = useRef({ depts, sessions, off });
  data.current = { depts, sessions, off };

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const ctx = cv.getContext('2d');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const css = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
    let w = 0, h = 0, dpr = 1, raf = 0, net = null, layer = null, key = '';
    const signals = [];
    const motes = [];
    const beats = new Map();   // 허브 → 다음 박자 시각

    const paint = () => {
      const colors = { g1: css('--g1', '#7C8CFF'), g2: css('--g2', '#4FE3FF'), line: document.documentElement.dataset.theme === 'light' ? '#3A8FB0' : '#7FD6F2' };
      net = build(w, h, data.current.depts, colors);
      layer = document.createElement('canvas');
      layer.width = cv.width; layer.height = cv.height;
      const g = layer.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.lineCap = 'round';
      // 가늘어지는 선: 앞쪽은 굵고 끝으로 갈수록 가늘고 옅게
      const taper = (pts, w0, w1, col, a0, a1) => {
        for (let i = 1; i < pts.length; i++) {
          const u = i / pts.length;
          g.strokeStyle = rgba(col, a0 + (a1 - a0) * u); g.lineWidth = w0 + (w1 - w0) * u;
          g.beginPath(); g.moveTo(pts[i - 1].x, pts[i - 1].y); g.lineTo(pts[i].x, pts[i].y); g.stroke();
        }
      };
      for (const t of net.twigs) taper(t.pts, 0.9, 0.15, t.c ?? colors.line, 0.16, 0.0);
      for (const e of net.edges) {
        const A = net.cells[e.a], B = net.cells[e.b];
        const col = A.c ?? B.c ?? colors.line;
        taper(e.pts, 1, 1, col, 0.2, 0.2);
      }
      for (const c of net.cells) {
        const col = c.c ?? colors.line;
        const R = c.r * (c.hub ? 7 : 4.5);
        const rg = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
        rg.addColorStop(0, rgba(col, c.hub ? 0.45 : 0.28)); rg.addColorStop(1, rgba(col, 0));
        g.fillStyle = rg; g.beginPath(); g.arc(c.x, c.y, R, 0, Math.PI * 2); g.fill();
        g.fillStyle = rgba(col, c.hub ? 0.85 : 0.5); g.beginPath(); g.arc(c.x, c.y, c.r, 0, Math.PI * 2); g.fill();
      }
      key = `${w}x${h}:${data.current.depts.map((d) => d.name + d.color).join('|')}:${document.documentElement.dataset.theme}`;
    };
    const fit = () => {
      const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
      w = r.width; h = r.height; cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (w > 0 && h > 0) paint();
    };
    const ro = new ResizeObserver(fit); ro.observe(cv); fit();

    // 발화: 세포 i에서 연결된 축삭으로 신호를 보낸다 (들어온 길은 빼고)
    const fire = (i, from = -1, now, strength = 1) => {
      const c = net.cells[i];
      if (now - c.fire < 420) return;     // 불응기
      c.fire = now; c.flash = 1;
      const outs = c.out.filter((e) => e !== from);
      const n = c.hub ? Math.min(outs.length, 2 + Math.round(strength)) : Math.min(outs.length, Math.random() < 0.3 ? 2 : 1);
      for (const e of outs.sort(() => Math.random() - 0.5).slice(0, n)) {
        const E = net.edges[e];
        signals.push({ e, dir: E.a === i ? 1 : -1, p: 0, v: 0.9 + Math.random() * 0.2, s: strength, born: now });
      }
    };

    let last = performance.now();
    const draw = (now) => {
      const dt = Math.min(64, now - last); last = now;
      // 숨긴 화면(지도·기억)에선 그리지 않고 기다린다 — 돌아오면 같은 망 그대로
      if (!net || data.current.off) { raf = requestAnimationFrame(draw); return; }
      const want = `${w}x${h}:${data.current.depts.map((d) => d.name + d.color).join('|')}:${document.documentElement.dataset.theme}`;
      if (want !== key) paint();
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(layer, 0, 0, w, h);
      if (still) return;

      // 박자: 일이 도는 부서의 허브는 일정 간격으로 발화, 그 밖엔 가끔 저절로
      const busy = new Map();
      for (const s of data.current.sessions) if (s.task?.dept) busy.set(s.task.dept, (busy.get(s.task.dept) ?? 0) + 1);
      net.cells.forEach((c, i) => {
        if (!c.hub) return;
        const next = beats.get(i) ?? now + Math.random() * 2000;
        if (!beats.has(i)) beats.set(i, next);
        if (now >= next) {
          const b = busy.get(c.hub) ?? 0;
          fire(i, -1, now, b ? 1.5 + b : 0.8);
          beats.set(i, now + (b ? 650 + Math.random() * 350 : 2600 + Math.random() * 1800));
        }
      });
      if (Math.random() < 0.05 * (dt / 16)) fire(Math.floor(Math.random() * net.cells.length), -1, now, 0.6);

      ctx.globalCompositeOperation = 'lighter';
      // 신호: 축삭을 따라 가는 빛 조각 (머리는 희고, 꼬리는 세포 색으로 사라진다)
      for (let k = signals.length - 1; k >= 0; k--) {
        const q = signals[k];
        const E = net.edges[q.e];
        const pts = E.pts, n = pts.length - 1;
        q.p += (SPEED * q.v * dt) / 1000 / E.L;   // 같은 속도: 긴 선은 오래, 짧은 선은 금방
        const head = Math.min(1, q.p);
        const hi = q.dir > 0 ? head * n : (1 - head) * n;
        const tail = 9;
        const A = net.cells[q.dir > 0 ? E.a : E.b], B = net.cells[q.dir > 0 ? E.b : E.a];
        const col = B.c ?? A.c ?? '#7FEFFF';
        for (let j = 0; j < tail; j++) {
          const idx = q.dir > 0 ? Math.floor(hi) - j : Math.ceil(hi) + j;
          const p0 = pts[Math.max(0, Math.min(n, idx))], p1 = pts[Math.max(0, Math.min(n, idx + (q.dir > 0 ? 1 : -1)))];
          const f = 1 - j / tail;
          ctx.strokeStyle = rgba(j < 2 ? '#FFFFFF' : col, f * (0.55 + 0.3 * q.s / 3));
          ctx.lineWidth = 1 + f * 2.2;
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
        const hp = pts[Math.max(0, Math.min(n, Math.round(hi)))];
        const rg = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, 9);
        rg.addColorStop(0, rgba('#FFFFFF', 0.9)); rg.addColorStop(0.3, rgba(col, 0.55)); rg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(hp.x, hp.y, 9, 0, Math.PI * 2); ctx.fill();
        if (q.p >= 1) {
          signals.splice(k, 1);
          const to = q.dir > 0 ? E.b : E.a;
          const T = net.cells[to];
          // 시냅스 틈: 전달물질이 흩어진다
          for (let m = 0; m < 6; m++) { const a = Math.random() * Math.PI * 2, v = 0.02 + Math.random() * 0.05; motes.push({ x: T.x, y: T.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: col }); }
          // 연쇄: 허브는 잘 이어 받고, 신호가 셀수록 멀리 간다
          const go = T.hub ? 0.9 : 0.45 + 0.12 * q.s;
          if (Math.random() < go && signals.length < 140) fire(to, q.e, now, Math.max(0.5, q.s * 0.85));
          else T.flash = Math.max(T.flash, 0.6);
        }
      }
      // 전달물질 입자
      for (let k = motes.length - 1; k >= 0; k--) {
        const m = motes[k]; m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt / 700;
        if (m.life <= 0) { motes.splice(k, 1); continue; }
        ctx.fillStyle = rgba(m.c, m.life * 0.8); ctx.beginPath(); ctx.arc(m.x, m.y, 1.1, 0, Math.PI * 2); ctx.fill();
      }
      // 발화한 세포의 번쩍임 (빠르게 켜지고 천천히 식는다)
      for (const c of net.cells) {
        if (c.flash <= 0.01) continue;
        const col = c.c ?? '#7FEFFF';
        const R = c.r * (c.hub ? 10 : 7) * (0.6 + c.flash * 0.6);
        const rg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
        rg.addColorStop(0, rgba('#FFFFFF', 0.7 * c.flash)); rg.addColorStop(0.25, rgba(col, 0.55 * c.flash)); rg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.fill();
        c.flash *= Math.pow(0.93, dt / 16);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    const wake = () => { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(draw); };
    document.addEventListener('visibilitychange', wake);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', wake); };
  }, []);

  return <canvas ref={ref} className={`syn-field ${off ? 'off' : ''}`} aria-hidden="true" />;
}
