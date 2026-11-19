// 프로세스 지도 (원본의 "지도"): 가운데 비서실장 → 부서 → 하위 항목 → 작업 카드(상태·머문 시간·진행 로그) → 하위 작업·결정·보고서.
// 부서·하위 항목·작업은 그 자리에서 펼치고 접는다 — 다른 화면으로 들어가지 않고 한 지도 안에서 일이 어디서 돌고 있는지 따라간다.
// 실행 중·결정 필요 가지는 저절로 펼쳐지고, 펼치거나 접어도 누른 자리가 화면에서 움직이지 않는다.
// 카드를 누르면 오른쪽 패널에 연다(가운데 지도는 그대로). 줌 단계: 가까이 = 카드 전체, 중간 = 로그 숨김, 멀리 = 점 + 제목.
// 두뇌가 띄우지 않은 PC 일(Claude Code 세션·AI 프로그램)도 그 부서 아래에 뜬다. 일이 도는 길(비서실장 → 부서 → … → 카드)과
// 연계 선(바깥 일 ↔ 작업·공정)에는 시냅스 신호가 흐른다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Progress, StatusTag } from './TaskBits.jsx';
import { TAX_COLOR } from './TaxCalendar.jsx';
import { PHASE } from './Process.jsx';
import { buildTree, layoutMap } from './map/layout.js';
import { workingIds, unseenAnswers, useSeen } from './useSessions.js';

const SYN_GAP = 200;   // 시냅스 점 사이 간격(px) — 넓게: 한 선에 점이 몰리지 않게
// (예전 멀리 보기 전환 기준 — 지금은 쓰지 않음)
const K_COMPACT = 0.85;
// 내 차례로 보는 attention kind — 기다림(호박) / 새 답(연두)
const WAIT_KINDS = new Set(['결정', '권한', '입력대기', '승인']);
// 보기 렌즈: 지금(도는 것·내 차례만 또렷) · 오늘(오늘 끝난 일을 펼쳐 결과 한 줄) · 전체
const LENSES = [['now', '지금', '작업 중과 내 차례만 또렷하게'], ['today', '오늘', '오늘 끝난 일을 펼쳐 결과까지'], ['all', '전체', '모두 같은 밝기로']];
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 없어도 됨 */ } } };
// 자료 더미: 그래프 노드 type → 칸
const PILE_KIND = { 보고서: 'rep', 참고: 'doc', 노트: 'doc', 기억카드: 'card' };
// 작업 본문에서 결과 한 줄: "## 결과" 첫 줄, 없으면 진행 로그 마지막 줄
const resultLine = (body) => {
  const lines = String(body ?? '').split(/\r?\n/);
  const at = lines.findIndex((l) => /^##\s*결과/.test(l));
  if (at >= 0) { const l = lines.slice(at + 1).find((x) => x.trim() && !/^##\s/.test(x)); if (l && !/^##\s/.test(l)) return plain(l.replace(/^[-*]\s*/, ''), 120); }
  const lg = lines.findIndex((l) => /^##\s*진행 로그/.test(l));
  if (lg >= 0) {
    const rest = lines.slice(lg + 1);
    const end = rest.findIndex((x) => /^##\s/.test(x));
    const last = (end >= 0 ? rest.slice(0, end) : rest).filter((x) => x.trim().startsWith('-')).at(-1);
    if (last) return plain(last.replace(/^\s*-\s*/, ''), 120);
  }
  return '';
};
import { Share, UsageGauge, useUsage } from './Usage.jsx';
import { STATE, nowLine, useActivity, where } from './Activity.jsx';
import { OPEN_STATUSES, ago, isToday, linkTarget, plain, scheduleText, toolName } from './util.js';

const K_MIN = 0.12, K_MAX = 2.4;
const pad = (n) => String(n).padStart(2, '0');
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* 없어도 됨 */ } } };
const loadOpen = () => { try { return new Map(JSON.parse(ss.get('brain.map.open') ?? '[]')); } catch { return new Map(); } };

// 선 id → SVG id (한글·기호가 든 노드 id를 짧은 해시로)
const edgeId = (s) => { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0; return `me${(h >>> 0).toString(36)}`; };

export function MapView({ ctx, dept }) {
  const host = useRef(null);
  const [paused, setPaused] = useState(false);
  const [snap, setSnap] = useState(null);           // 일시정지 때 굳힌 작업 목록
  const [events, setEvents] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(new Date());
  const [filter, setFilter] = useState(() => dept ?? null);   // 부서 하나만 보기 (고르기 상자로만)
  const [open, setOpenMap] = useState(loadOpen);              // 사용자가 펼치거나 접은 가지 (id → bool)
  const [cam, setCam] = useState({ x: 0, y: 0, k: 0.8 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const fitted = useRef(null);
  const anchor = useRef(null);                                 // 펼치고 접을 때 화면에 붙여 둘 노드

  useEffect(() => { ss.set('brain.map.open', JSON.stringify([...open])); }, [open]);
  useEffect(() => { setFilter(dept ?? null); }, [dept]);

  // 진행 로그 (카드마다 마지막 3줄). 일시정지면 다시 읽지 않는다
  useEffect(() => {
    if (paused) return undefined;
    let alive = true;
    api.timeline().then((e) => { if (alive) { setEvents(e); setUpdatedAt(new Date()); } }).catch(() => {});
    return () => { alive = false; };
  }, [ctx.tick, paused]);

  const togglePause = () => { setSnap(paused ? null : ctx.state.tasks); setPaused((v) => !v); };
  const tasksNow = paused && snap ? snap : ctx.state.tasks;
  // 일하는 작업(앱에서 연 바깥 세션 포함) — 카드가 빛난다
  const workingKey = [...workingIds(ctx.sessions)].sort().join(',');
  const working = useMemo(() => new Set(workingKey ? workingKey.split(',') : []), [workingKey]);

  const { visible, done, logs, pending, reports } = useMemo(() => {
    const logs = new Map();
    for (const e of events) { const l = logs.get(e.task) ?? logs.set(e.task, []).get(e.task); if (l.length < 3) l.push(e); }
    const visible = [];
    const done = new Map();
    for (const t of tasksNow) {
      const v = { ...t, parentId: linkTarget(t.parent), live: t.runtime?.phase === '실행' || working.has(t.id) };
      if (OPEN_STATUSES.includes(t.status)) visible.push(v);
      else if (isToday(t.updated)) (done.get(t.dept) ?? done.set(t.dept, []).get(t.dept)).push(v);
    }
    const pending = new Map(Object.entries(ctx.pendingByTask));
    const reports = new Map();
    for (const r of ctx.state.reports) { const t = linkTarget(r.task); if (t) (reports.get(t) ?? reports.set(t, []).get(t)).push(r); }
    return { visible, done, logs, pending, reports };
  }, [tasksNow, events, ctx.pendingByTask, ctx.state.reports, working]);

  // 공정: 가동·정지 수, 정지 공정 숨기기 (가동 공정은 늘 보인다)
  const [hideStopped, setHideStopped] = useState(() => ss.get('brain.map.hideStopped') === '1');
  useEffect(() => { ss.set('brain.map.hideStopped', hideStopped ? '1' : '0'); }, [hideStopped]);
  const allProcs = ctx.state.processes ?? [];
  const procsOn = allProcs.filter((p) => p.status === '가동').length;
  const processes = useMemo(() => (hideStopped ? allProcs.filter((p) => p.status === '가동') : allProcs), [allProcs, hideStopped]);

  // PC에서 도는 바깥 일 (일시정지면 그대로 둔다)
  const act = useActivity(!paused);
  // 같은 자리(세션·부서·하위)의 같은 이름 프로그램은 한 장으로 묶는다 (node · npx-cli.js ×5) — 사용량은 합산
  const outside = useMemo(() => {
    const groups = new Map();
    for (const g of act?.programs ?? []) {
      const k = `${g.session ?? ''}|${g.dept ?? ''}|${g.unit ?? ''}|${g.label}`;
      const m = groups.get(k);
      if (!m) { groups.set(k, { ...g, pids: [...(g.pids ?? [])], tasks: [...(g.tasks ?? [])] }); continue; }
      m.count = (m.count ?? 1) + (g.count ?? 1);
      m.pids.push(...(g.pids ?? []));
      for (const f of ['cpu', 'gpu', 'mem', 'memPct', 'vram', 'vramPct']) m[f] = (m[f] ?? 0) + (g[f] ?? 0);
      for (const t of g.tasks ?? []) if (!m.tasks.includes(t)) m.tasks.push(t);
      m.proc = m.proc ?? g.proc;
    }
    return { sessions: act?.sessions ?? [], programs: [...groups.values()] };
  }, [act]);

  // 보기 렌즈 · PC 사용량 계기판 펼침 (localStorage에 기억)
  const [lens, setLensS] = useState(() => (LENSES.some(([k]) => k === ls.get('brain.map.lens')) ? ls.get('brain.map.lens') : 'all'));
  const reanchor = useRef(false);   // 다음 배치에서 화면 가운데 노드를 제자리에 붙여 둔다 (렌즈를 바꿀 때)
  const setLens = (v) => { if (v !== lens) reanchor.current = true; setLensS(v); ls.set('brain.map.lens', v); };
  const [gaugeOpen, setGaugeOpenS] = useState(() => ls.get('brain.map.gauge') === '1');
  const setGaugeOpen = (v) => { setGaugeOpenS(v); ls.set('brain.map.gauge', v ? '1' : '0'); };

  // 내 차례: 안 읽은 새 답·검수(연두), 입력대기·결정·권한·승인과 결정 카드(호박)
  const [seen] = useSeen();
  const turn = useMemo(() => {
    const tasks = new Map(), sessions = new Map();
    const put = (m, id, v) => { if (id && m.get(id) !== 'wait') m.set(id, v); };
    for (const x of unseenAnswers(ctx.attention, seen)) { put(tasks, x.task, 'answer'); put(sessions, x.session, 'answer'); }
    for (const x of ctx.attention ?? []) if (WAIT_KINDS.has(x.kind)) { put(tasks, x.task, 'wait'); put(sessions, x.session, 'wait'); }
    for (const id of Object.keys(ctx.pendingByTask)) put(tasks, id, 'wait');
    return { tasks, sessions };
  }, [ctx.attention, seen, ctx.pendingByTask]);

  // 기억 층: 하위 항목·부서마다 쌓인 자료 (그래프의 parent를 따라 올라가 처음 만나는 하위·부서에 센다)
  const piles = useMemo(() => {
    const g = ctx.graph?.nodes ?? [];
    const by = new Map(g.map((n) => [n.id, n]));
    const out = new Map();
    for (const n of g) {
      const kind = PILE_KIND[n.type];
      if (!kind) continue;
      let p = n.parent, hops = 0;
      while (p && hops < 12 && !String(p).startsWith('하위:') && !String(p).startsWith('부서:')) { p = by.get(p)?.parent; hops += 1; }
      if (!p || !(String(p).startsWith('하위:') || String(p).startsWith('부서:'))) continue;
      const pile = out.get(p) ?? out.set(p, { rep: 0, doc: 0, card: 0, items: [] }).get(p);
      pile[kind] += 1;
      pile.items.push({ id: n.id, title: n.title ?? n.id, kind, at: n.time ?? n.created ?? '' });
    }
    for (const pile of out.values()) pile.items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return out;
  }, [ctx.graph]);

  // 오늘 보기: 끝난 일의 결과 한 줄 (작업 본문을 한 번씩만 읽어 둔다 — 고친 시각이 바뀌면 다시)
  const [results, setResults] = useState(() => new Map());
  const doneKey = [...done.values()].flat().map((t) => `${t.id}@${t.updated}`).sort().join(',');
  useEffect(() => {
    if (lens !== 'today' || !doneKey) return undefined;
    let alive = true;
    const want = doneKey.split(',').filter((k) => !results.has(k));
    if (!want.length) return undefined;
    Promise.all(want.map((k) => api.task(k.split('@')[0]).then((t) => [k, resultLine(t.body)]).catch(() => [k, ''])))
      .then((pairs) => { if (alive) setResults((m) => { const n = new Map(m); for (const [k, v] of pairs) n.set(k, v); return n; }); });
    return () => { alive = false; };
    // results는 일부러 뺀다 (읽은 것을 다시 읽지 않게 위에서 거른다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens, doneKey]);
  const resultOf = (t) => results.get(`${t.id}@${t.updated}`) || plain((logs.get(t.id) ?? [])[0]?.text ?? '', 120);

  // 멀리 볼 때 카드 모양·글자 크기를 바꾸지 않는다 — 배율이 바뀌면 위치가 흔들려 더 헷갈린다(주인 말). 늘 같은 배치, 그냥 작게
  const compact = false;
  const depts = ctx.state.depts;
  // 일정비서 목록 (비서실 / 일정비서 아래 섹션·일정 카드) — 바뀔 때마다(tick) 다시 읽는다
  const [todayV, setTodayV] = useState(null);
  useEffect(() => { let alive = true; api.today().then((v) => alive && setTodayV(v)).catch(() => {}); return () => { alive = false; }; }, [ctx.tick]);
  const [clearing, setClearing] = useState(null);
  const skipItem = async (c) => {
    setClearing(c.id);
    try { setTodayV(await api.todaySkip(c.id)); } catch (e) { console.error("일정 스킵 실패:", e.message); } finally { setClearing(null); }
  };
  const clearItem = async (c, undo = false) => {
    setClearing(c.id);
    try { setTodayV(await api.todayDone(c.id, undo)); } catch (e) { console.error("일정 완료 실패:", e.message); } finally { setClearing(null); }
  };
  const tree = useMemo(() => buildTree({ depts, units: ctx.state.units ?? [], processes, outside, tasks: visible, done, pending, reports, open, filter, doneInline: lens === 'today', turn, piles, today: todayV }),
    [depts, ctx.state.units, processes, outside, visible, done, pending, reports, open, filter, lens, turn, piles, todayV]);
  const calm = useMemo(() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }, []);
  const lay = useMemo(() => Object.assign(layoutMap(tree, { compact, gauge: gaugeOpen }), { compact }), [tree, compact, gaugeOpen]);
  // 사용량: 계기판이 지도에 있을 때만 묻는다 (일시정지면 멈춤)
  const hasGauge = lay.nodes.some((n) => n.kind === 'usage');
  // 세무달력 카드가 지도에 있을 때만 일정을 읽는다 (일정은 하루 단위라 처음과 새로고침 때만)
  const hasTax = lay.nodes.some((n) => n.kind === 'taxcal');
  const [tax, setTax] = useState(null);
  useEffect(() => { if (hasTax) api.taxcal().then(setTax).catch(() => {}); }, [hasTax, ctx.tick]);
  const usage = useUsage(hasGauge && !paused);
  const outsideBusy = outside.sessions.filter((s) => s.state === '작업중').length;
  const shareOf = (id) => usage?.tasks.find((x) => x.task === id);

  // 펼치기·접기: 누른 노드의 화면 자리를 기억했다가, 새 배치에서 그 자리로 카메라를 맞춘다
  const toggle = (n) => {
    const c = camRef.current;
    anchor.current = { id: n.id, sx: c.x + n.x * c.k, sy: c.y + n.y * c.k };
    setOpenMap((m) => new Map(m).set(n.id, !n.open));
  };
  // 배율이 멀리/가까이 경계를 넘으면 카드 크기가 바뀌어 배치가 달라진다 — 커서(없으면 화면 가운데)에 가장 가까운 노드를 그 자리에 붙여 둔다
  const prevLay = useRef(null);
  const ptr = useRef(null);
  useLayoutEffect(() => {
    const old = prevLay.current;
    prevLay.current = lay;
    let a = anchor.current;
    anchor.current = null;
    const again = reanchor.current;
    reanchor.current = false;
    if (!a && old && (old.compact !== lay.compact || again) && host.current) {
      const c = camRef.current;
      const p = (!again && ptr.current) || { x: host.current.clientWidth / 2, y: host.current.clientHeight / 2 };
      const ids = new Set(lay.nodes.map((m) => m.id));
      const wx = (p.x - c.x) / c.k, wy = (p.y - c.y) / c.k;
      let best = null, bd = Infinity;
      for (const n of old.nodes) {
        const d = Math.hypot(n.x + n.w / 2 - wx, n.y + n.h / 2 - wy);
        if (d < bd && ids.has(n.id)) { bd = d; best = n; }
      }
      if (best) a = { id: best.id, sx: c.x + best.x * c.k, sy: c.y + best.y * c.k };
    }
    if (!a) return;
    const n = lay.nodes.find((x) => x.id === a.id);
    if (n) setCam((c) => ({ ...c, x: a.sx - n.x * c.k, y: a.sy - n.y * c.k }));
  }, [lay]);
  const setAll = (v) => {
    const ids = [];
    const walk = (n) => { if (n.children?.length) ids.push(n.id); n.children?.forEach(walk); };
    tree.forEach(walk);
    setOpenMap(new Map(ids.map((id) => [id, v])));
    fitted.current = null;
  };

  // 화면에 맞추기 (위 도구 줄과 아래 입력창에 가리지 않게)
  const fit = useCallback((b = lay.bounds) => {
    const el = host.current;
    if (!el) return;
    const TOP = 56, BOTTOM = 110;
    const w = el.clientWidth, h = Math.max(200, el.clientHeight - TOP - BOTTOM);
    const bw = b.x1 - b.x0 + 80, bh = b.y1 - b.y0 + 40;
    const k = Math.max(K_MIN, Math.min(1, w / bw, h / bh));
    setCam({ k, x: w / 2 - ((b.x0 + b.x1) / 2) * k, y: TOP + h / 2 - ((b.y0 + b.y1) / 2) * k });
  }, [lay.bounds]);
  // 처음, 부서 고르기를 바꿨을 때, 모두 펼치기·접기 뒤에 맞춘다
  useLayoutEffect(() => {
    const key = `${filter ?? ''}`;
    if (fitted.current !== key && host.current?.clientWidth) { fitted.current = key; fit(); }
  }, [filter, fit]);

  // 휠 = 커서 자리 기준 확대, 바탕 끌기 = 이동
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      ptr.current = { x: px, y: py };
      const c = camRef.current;
      const k = Math.max(K_MIN, Math.min(K_MAX, c.k * Math.pow(1.5, -e.deltaY / 240)));
      setCam({ k, x: px - ((px - c.x) / c.k) * k, y: py - ((py - c.y) / c.k) * k });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onDown = (e) => {
    if (!e.target.closest('.m-pile-pop, .m-pile')) setPilePop(null);
    if (e.button !== 0 || e.target.closest('button, select, .map-tools, .m-pile-pop')) return;
    const x0 = e.clientX, y0 = e.clientY, c0 = camRef.current;
    const move = (ev) => setCam({ ...c0, x: c0.x + ev.clientX - x0, y: c0.y + ev.clientY - y0 });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const zoomBy = (f) => {
    const el = host.current;
    const c = camRef.current;
    const px = el.clientWidth / 2, py = el.clientHeight / 2;
    ptr.current = null;
    const k = Math.max(K_MIN, Math.min(K_MAX, c.k * f));
    setCam({ k, x: px - ((px - c.x) / c.k) * k, y: py - ((py - c.y) / c.k) * k });
  };

  // 화면 크기 (가장자리 "할 일" 표식 계산용)
  const [view, setView] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 카메라를 한 노드로 부드럽게 옮긴다 (배율은 그대로)
  const [glide, setGlide] = useState(false);
  const glideT = useRef(null);
  const goTo = (n) => {
    const el = host.current;
    if (!el) return;
    const TOP = 56, BOTTOM = 110;
    const c = camRef.current;
    setGlide(true);
    clearTimeout(glideT.current);
    glideT.current = setTimeout(() => setGlide(false), 480);
    setCam({ ...c, x: el.clientWidth / 2 - (n.x + n.w / 2) * c.k, y: TOP + (el.clientHeight - TOP - BOTTOM) / 2 - (n.y + n.h / 2) * c.k });
  };
  useEffect(() => () => clearTimeout(glideT.current), []);
  // 화면 밖 내 차례: 가장자리(왼·오른·위·아래)별로 모아 표식 하나씩 — 접힌 가지 안에 숨은 것은 그 가지를 가리킨다
  const offscreen = useMemo(() => {
    if (!view.w) return [];
    const TOP = 56, BOTTOM = 110, M = 8;
    const box = { x0: 0, y0: TOP, x1: view.w, y1: view.h - BOTTOM };
    const sides = new Map();
    for (const n of lay.nodes) {
      const cnt = (n.turn ? 1 : 0) + (n.turnIn ?? 0);
      if (!cnt) continue;
      const cx = cam.x + (n.x + n.w / 2) * cam.k, cy = cam.y + (n.y + n.h / 2) * cam.k;
      const hw = (n.w * cam.k) / 2, hh = (n.h * cam.k) / 2;
      if (cx + hw > box.x0 + M && cx - hw < box.x1 - M && cy + hh > box.y0 + M && cy - hh < box.y1 - M) continue;
      const over = { left: box.x0 - cx, right: cx - box.x1, top: box.y0 - cy, bottom: cy - box.y1 };
      const side = Object.entries(over).sort((a, b) => b[1] - a[1])[0][0];
      const s = sides.get(side) ?? sides.set(side, { side, count: 0, wait: false, list: [], pos: 0 }).get(side);
      s.count += cnt;
      s.wait ||= n.turn === 'wait' || n.waitIn > 0;
      s.list.push({ n, d: Math.hypot(cx - view.w / 2, cy - view.h / 2), cx, cy });
    }
    for (const s of sides.values()) {
      s.list.sort((a, b) => a.d - b.d);
      const avg = s.list.reduce((a, x) => a + (s.side === 'left' || s.side === 'right' ? x.cy : x.cx), 0) / s.list.length;
      s.pos = s.side === 'left' || s.side === 'right' ? Math.max(box.y0 + 20, Math.min(box.y1 - 20, avg)) : Math.max(120, Math.min(box.x1 - 120, avg));
    }
    return [...sides.values()];
  }, [lay, cam, view]);

  // 자료 더미 목록 (떠 있는 작은 창)
  const [pilePop, setPilePop] = useState(null);
  const openPile = (e, n) => {
    e.stopPropagation();
    const r = host.current.getBoundingClientRect();
    const id = n.kind === 'unit' ? n.unit.id ?? `하위:${n.dept.name}/${n.unit.name}` : `부서:${n.dept.name}`;
    setPilePop((p) => (p?.id === id ? null : { id, title: n.kind === 'unit' ? `${n.dept.name} / ${n.unit.name}` : n.dept.name, pile: n.pile,
      x: Math.min(e.clientX - r.left, r.width - 300), y: Math.min(e.clientY - r.top + 12, r.height - 360) }));
  };
  const pileChip = (n) => {
    const p = n.pile;
    if (!p) return null;
    const total = p.rep + p.doc + p.card;
    const parts = [p.rep && `보고서 ${p.rep}`, p.doc && `문서 ${p.doc}`, p.card && `기억 카드 ${p.card}`].filter(Boolean).join(' · ');
    return (
      <button key={`pile:${n.id}`} className={`m-pile ${n.kind} ${pilePop?.id === (n.kind === 'unit' ? n.unit.id : `부서:${n.dept.name}`) ? 'on' : ''} ${dimCls(n)}`}
        style={{ left: n.x + n.w - 40, top: n.y + n.h / 2 - 10, transformOrigin: `${40 - n.w / 2}px 10px` }} onClick={(e) => openPile(e, n)} title={`쌓인 자료 — ${parts}`} aria-label={`쌓인 자료 ${parts}`}>
        <i aria-hidden /><span className="mono">{total}</span>
      </button>
    );
  };
  // 지금 보기: 도는 것·내 차례 가지가 아니면 흐리게 (눌러지기는 한다)
  const dimCls = (n) => (lens === 'now' && !n.focus ? 'm-dim' : '');
  const turnCls = (n) => {
    const busy = n.task ? n.task.live : n.kind === 'pcs' ? n.sess.state === '작업중' : n.live;
    return n.turn && !busy ? `turn turn-${n.turn}` : '';
  };

  const lod = cam.k < 0.34 ? 'far' : cam.k < K_COMPACT ? 'mid' : 'near';
  const running = visible.filter((t) => t.live).length;
  const doneToday = [...done.values()].reduce((s, l) => s + l.length, 0);
  const color = ctx.deptColor;

  // 펼치기·접기 손잡이: 가지 바깥쪽 끝에 "−" 또는 "+N"
  const knob = (n) => (n.children?.length ? (
    <button key={`k:${n.id}`} className={`m-knob ${n.open ? 'open' : ''} ${n.live && !n.open ? 'live' : ''} ${n.turnIn ? 'turn' : ''} ${dimCls(n)}`}
      style={{ left: n.side === 1 ? n.x + n.w + 5 : n.x - 27, top: n.y + n.h / 2 - 11 }}
      onClick={() => toggle(n)} title={n.open ? '접기' : `펼치기 (작업 ${n.hidden})`}>
      {n.open ? '−' : `+${n.hidden || n.children.length}`}
    </button>
  ) : null);

  return (
    <div className={`mapview lod-${lod} ${compact ? 'map-compact' : ''} lens-${lens}`} ref={host} onPointerDown={onDown}>
      <div className={`map-world ${glide ? 'glide' : ''}`} style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`, '--k': cam.k }}>
        <svg className="map-edges" width="1" height="1" aria-hidden>
          {lay.edges.map((e) => <path key={e.id} id={edgeId(e.id)} d={e.d} className={`me me-${e.kind} ${e.live ? 'live' : ''} ${lens === 'now' && !e.focus ? 'm-dim' : ''}`} />)}
          {/* 시냅스: 도는 길마다 빛 점이 부모 → 자식(연계 선은 바깥 일 → 작업)으로 흐른다.
              모든 선에서 같은 속도, 점 사이 간격도 같다(SYN_GAP px) — 긴 선엔 점이 많고 짧은 선엔 적다 */}
          {!calm && lay.edges.filter((e) => e.live).map((e) => {
            const n = Math.max(1, Math.round((e.len ?? 120) / SYN_GAP));
            return (
            <g key={`syn:${e.id}`} className={`syn syn-${e.kind}`}>
              {Array.from({ length: n }, (_, k) => (
                <circle key={k} className="syn-dot">
                  <animateMotion dur={`${e.dur.toFixed(2)}s`} begin={`${(-k * e.dur / n).toFixed(2)}s`} repeatCount="indefinite" rotate="auto">
                    <mpath href={`#${edgeId(e.id)}`} />
                  </animateMotion>
                </circle>
              ))}
            </g>
            );
          })}
        </svg>
        {lay.nodes.map((n) => {
          // 왼쪽 가지의 카드는 빛 호가 반시계로 돈다 (가지가 뻗는 쪽에서 감아 오도록)
          const style = { left: n.x, top: n.y, width: n.w, height: n.h, '--dir': n.side === -1 ? 'reverse' : 'normal' };
          if (n.kind === 'chief') {
            return (
              <button key="chief" className="m-chief" style={style} onClick={() => ctx.inspect('inbox')} title="결재함 열기">
                <span>관제실</span>
                <span className="m-sum">실행 {running}{outsideBusy ? ` · 바깥 ${outsideBusy}` : ''} · 확인 필요 {ctx.state.needsMe} · 오늘 끝 {doneToday}</span>
              </button>
            );
          }
          if (n.kind === 'dept') {
            return [
              <button key={n.id} className={`m-dept ${n.live ? 'live' : ''} ${n.pile ? 'has-pile' : ''} ${dimCls(n)}`} style={{ ...style, '--c': n.dept.color }} onClick={() => toggle(n)} title={n.open ? '가지 접기' : '가지 펼치기'}>
                <i /><span className="m-no">{pad(n.dept.order ?? 0)}</span><b>{n.dept.name}</b><span className="m-cnt">{visible.filter((t) => t.dept === n.dept.name).length || '—'}</span>
              </button>,
              pileChip(n),
              knob(n),
            ];
          }
          if (n.kind === 'unit') {
            return [
              // 누르면 하위 문서(명령 버튼·하는 일)를 오른쪽 패널에, 접고 펴기는 옆 손잡이로
              <button key={n.id} className={`m-unit ${n.live ? 'live' : ''} ${ctx.route.panel === n.unit.id ? 'sel' : ''} ${n.pile ? 'has-pile' : ''} ${dimCls(n)}`} style={{ ...style, '--c': n.dept.color }} onClick={(e) => ctx.pick(n.unit.id, e)} title={`${n.dept.name} / ${n.unit.name}${n.unit.summary ? `\n${n.unit.summary}` : ''}`}>
                <i />{n.unit.name}{n.unit.commands && <em className="m-unit-cmd" title="명령 버튼 있음">⌘</em>}
              </button>,
              pileChip(n),
              knob(n),
            ];
          }
          if (n.kind === 'tsec') {
            // 일정비서 섹션: 눌러서 접고 펴기 — 마감 지남은 빨강, 끝낸 일은 흐리게
            const s = n.sec;
            return [
              <button key={n.id} className={`m-tsec k-${s.key} ${dimCls(n)}`} style={style} onClick={() => toggle(n)} title={`${s.title} — 눌러서 ${n.open ? '접기' : '펼치기'}`}>
                <i /><b>{s.short}</b><span className="grow" /><span className="mono">{s.count}</span>
              </button>,
            ];
          }
          if (n.kind === 'titem') {
            // 일정 한 줄: 체크 = 완료로 지우기(끝낸 일에선 되살리기) · 제목 = 링크(바깥) 또는 작업 열기(두뇌)
            const c = n.item;
            const isDone = c.box === 'x';
            const canCheck = c.clearable || c.undo;
            const panel = c.task ? c.task : `todo:${c.id}`;
            const linked = c.task ? ctx.state.tasks.find((t) => t.id === c.task) : null;
            const sel = ctx.route.panel === panel;
            return (
              <div key={n.id} className={`m-titem ${isDone ? 'done' : ''} ${c.late ? 'late' : ''} ${linked?.live || c.taskLive ? 'live' : ''} ${sel ? 'sel' : ''} ${clearing === c.id ? 'busy' : ''} ${dimCls(n)}`} style={style}>
                {canCheck
                  ? <button className={`mti-box ${isDone ? 'on' : ''}`} onClick={() => clearItem(c, isDone)} title={isDone ? (c.skipped ? '내 일로 되돌리기' : '되살리기 (할 일로 되돌림)') : '완료로 지우기'} aria-label={isDone ? '되살리기' : '완료'}>{isDone && <Icon name="check" size={11} />}</button>
                  : <span className={`mti-box ${c.box == null ? 'dot' : isDone ? 'on' : ''} fixed`} aria-hidden>{isDone && <Icon name="check" size={11} />}</span>}
                <button className="mti-main" onClick={(e) => ctx.pick(panel, e)} title={[c.target && `${c.target} · `, c.title, c.note && `\n${c.note}`, '\n눌러서 열기 — 완료 체크·이어 시키기'].filter(Boolean).join('')}>
                  <span className="mti-title">{c.label && <b>{c.label} </b>}{c.time && <span className="mono">{c.time} </span>}{c.target && c.source !== '두뇌' && <b className="mti-who">{c.target} · </b>}{c.title}</span>
                  <span className="mti-meta">
                    <em className={`mti-src s-${c.source}`}>{c.source}</em>
                    {c.due && <span className={c.late ? 'mti-late' : ''}>마감 {c.dueLabel}{c.late ? ` · ${c.late}일 지남` : ''}</span>}
                    {!c.due && (c.note || c.where) && <span className="mti-note">{c.note || c.where}</span>}
                    {c.flag && <span>{c.flag}</span>}
                    {linked && c.source !== '두뇌' && <span className="mti-task">↳ {linked.status === '실행중' ? '작업 중' : linked.status}</span>}
                  </span>
                </button>
                {c.clearable && c.source !== '두뇌' && <button className="mti-skip" onClick={() => skipItem(c)} title="내 일 아님 — 목록에서 빼기 (30일 동안 다시 뜨지 않음)" aria-label="내 일 아님 · 스킵">스킵</button>}
              </div>
            );
          }
          if (n.kind === 'more') {
            return [
              <button key={n.id} className={`m-more ${dimCls(n)}`} style={style} onClick={() => toggle(n)}>{n.open ? '오늘 끝 접기' : `+${n.count} 오늘 끝`}</button>,
            ];
          }
          if (n.kind === 'taxcal') {
            // 세무달력 (경영지원실 / 재경부): 가까운 마감 셋 — 누르면 달력 보기
            const next = taxNext(tax);
            return (
              <button key={n.id} className={`m-tax ${next.some((e) => e.dd <= 3) ? 'hot' : ''} ${dimCls(n)}`} style={{ ...style, '--c': n.dept.color }} onClick={() => ctx.go({ view: 'calendar' })} title="세무달력 — 눌러서 달력으로">
                <div className="mt-top"><span className="mt-k">세무달력</span><span className="grow" /><span className="mono">{tax ? `이달 ${next.month}건` : '…'}</span></div>
                {next.length ? next.map((e) => (
                  <div key={e.key} className="mt-row" style={{ '--k': TAX_COLOR[e.kind] }}>
                    <i /><span className="mono mt-d">{e.date.slice(5).replace('-', '/')}</span><span className="mt-n">{e.name}</span><b className={`mono ${e.dd <= 3 ? 'hot' : ''}`}>{e.dd === 0 ? 'D-DAY' : `D-${e.dd}`}</b>
                  </div>
                )) : <div className="mt-row empty">{tax ? '다가오는 마감 없음' : '불러오는 중'}</div>}
              </button>
            );
          }
          if (n.kind === 'usage') {
            const hot = usage && Math.max(usage.cpu, usage.ram.pct, usage.gpu?.util ?? 0) >= 85;
            // 기본은 한 줄로 접혀 있다 — 누르면 펼침 (펼친 계기판은 오른쪽 위 손잡이로 다시 접기)
            if (!gaugeOpen) {
              return (
                <button key={n.id} className={`m-usage-mini ${hot ? 'hot' : ''} ${dimCls(n)}`} style={{ ...style, '--c': n.dept.color }} onClick={() => { const c = camRef.current; anchor.current = { id: n.id, sx: c.x + n.x * c.k, sy: c.y + n.y * c.k }; setGaugeOpen(true); }} title="PC 사용량 — 눌러서 계기판 펼치기">
                  <span>PC 사용량</span><span className="grow" />
                  <span className="mono">{usage ? `CPU ${Math.round(usage.cpu)}% · RAM ${Math.round(usage.ram.pct)}%` : '재는 중'}</span>
                  <em aria-hidden>+</em>
                </button>
              );
            }
            return [
              <button key={`fold:${n.id}`} className="m-gauge-fold" style={{ left: n.x + n.w - 30, top: n.y + 6 }} onClick={() => { const c = camRef.current; anchor.current = { id: n.id, sx: c.x + n.x * c.k, sy: c.y + n.y * c.k }; setGaugeOpen(false); }} title="계기판 접기">−</button>,
              <button key={n.id} className={`m-usage ${hot ? 'hot' : ''} ${ctx.route.panel === 'usage' ? 'sel' : ''} ${dimCls(n)}`} style={{ ...style, '--c': n.dept.color }} onClick={() => ctx.inspect('usage')} title="PC 사용량 — 눌러서 자세히">
                <UsageGauge u={usage} ctx={ctx} />
              </button>,
            ].reverse();
          }
          if (n.kind === 'proc') {
            // 가동 = 테두리를 도는 진행 호 + 초록 알약 + 지금 단계가 흐름, 정지 = 점선 테두리 + 일시정지 표시 + 흐린 색
            const p = n.proc;
            const at = Math.max(0, p.stages.indexOf(p.stage));
            const on = p.status === '가동';
            return [
              <button key={n.id} className={`m-proc ${on ? 'live' : 'stopped'} ${ctx.route.panel === p.id ? 'sel' : ''} ${dimCls(n)}`} style={{ ...style, '--c': color[p.dept] }} onClick={(e) => ctx.pick(p.id, e)}
                title={`${p.title} — ${p.summary ?? ''}`} aria-label={`공정 ${p.title}, ${p.status}, ${at + 1}/${p.stages.length}단계 ${p.stage}`}>
                <div className="mp-top">
                  <span className={`mp-st ${on ? 'on' : 'off'}`}>{on ? <i /> : <b aria-hidden />}{on ? '가동 중' : '정지'}</span>
                  <span className="mp-k">공정</span>
                  {p.phase && !['대기', '끝'].includes(p.phase) && <span className={`mp-ph ${PHASE[p.phase]?.cls ?? ''}`}>{PHASE[p.phase]?.label ?? p.phase}</span>}
                  <span className="grow" />
                  <span className="mono">{pad(at + 1)}<em>/{pad(p.stages.length)}</em></span>
                </div>
                <div className="mp-title">{p.title}</div>
                <div className="mp-item"><span className="mono">{on ? '지금' : '멈춘 곳'}</span>{p.item ?? '—'}</div>
                <div className="mp-stages" aria-hidden>
                  {p.stages.map((s, i) => <span key={s} className={i < at ? 'past' : i === at ? 'cur' : ''} title={s} />)}
                </div>
                <div className="mp-stage">
                  <b>{p.stage ?? p.stages[0]}</b>{p.stages[at + 1] ? <span> → {p.stages[at + 1]}</span> : null}
                  <span className="grow" /><em className="mono">{ago(p.updated)}</em>
                </div>
              </button>,
              knob(n),
            ];
          }
          if (n.kind === 'pcs') {
            // 바깥 세션 (두뇌가 띄우지 않은 Claude Code 대화): 상태 · 제목 · 지금 하는 일 · 어디서
            const s = n.sess;
            const st = STATE[s.state];
            return [
              <button key={n.id} className={`m-pcs ${st.cls} ${ctx.route.panel === 'activity' ? 'sel' : ''} ${turnCls(n)} ${dimCls(n)}`} style={{ ...style, '--c': color[s.dept] ?? 'var(--faint)' }}
                onClick={() => ctx.inspect('activity')} title={`${s.title}
${where(s)}
시킨 말: ${s.prompt ?? '—'}`}>
                <div className="mx-top">
                  <span className={`mx-st ${st.cls}`}><i />{st.label}</span>
                  <span className="mp-k">바깥 세션</span>
                  <span className="grow" />
                  {s.state === '작업중' && s.usage ? <Share x={s.usage} /> : <span className="mono">{ago(s.lastAt)}</span>}
                </div>
                <div className="mx-title">{s.title}</div>
                <div className="mx-now"><span className="mono">{s.state === '작업중' ? '지금' : '마지막'}</span>{nowLine(s, ctx.sessions)}
                  {s.state === '작업중' && <span className="sc-eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>}</div>
              </button>,
              knob(n),
            ];
          }
          if (n.kind === 'prog') {
            // AI 프로그램 (ollama·python·ffmpeg…): 이름 · 몇 개 · 사용량
            const g = n.prog;
            return (
              <button key={n.id} className={`m-prog ${n.live ? 'live' : 'idle'} ${dimCls(n)}`} style={{ ...style, '--c': color[g.dept] ?? 'var(--faint)' }}
                onClick={() => ctx.inspect('activity')} title={`${g.label} — ${where(g)} · pid ${g.pids.join(', ')}`}>
                <i /><b className="mono">{g.label}</b>{g.count > 1 && <span className="mono">×{g.count}</span>}<span className="grow" /><Share x={g} />
              </button>
            );
          }
          if (n.kind === 'dec') {
            const d = n.decision;
            return (
              <button key={n.id} className={`m-leaf dec ${d.kind === '권한' ? 'perm' : ''} ${dimCls(n)}`} style={style} onClick={(e) => ctx.pick(n.task.id, e)} title="결정 카드 — 눌러서 패널에서 고르기">
                <span className="m-leaf-k">{d.kind === '권한' ? '권한' : d.kind === '기억' ? '기억' : d.kind === '스킬' ? '스킬' : '결정'}</span><span className="m-leaf-t">{d.title}</span>
              </button>
            );
          }
          if (n.kind === 'rep') {
            return (
              <button key={n.id} className={`m-leaf rep ${dimCls(n)}`} style={style} onClick={(e) => ctx.pick(n.report.id, e)} title={n.report.title}>
                <span className="m-leaf-k">보고서</span><span className="m-leaf-t">{n.report.title}</span>
              </button>
            );
          }
          const t = n.task;
          const sel = ctx.route.panel === t.id;
          const pend = ctx.pendingByTask[t.id];
          if (n.kind === 'child') {
            return [
              <button key={t.id} className={`m-card child ${t.live ? 'live' : ''} ${pend ? 'decide' : ''} ${n.done ? 'done' : ''} ${sel ? 'sel' : ''} ${turnCls(n)} ${dimCls(n)}`} style={{ ...style, '--c': color[t.dept] }} onClick={(e) => ctx.pick(t.id, e)} title={t.title}>
                <div className="mc-title"><i className="mc-st" aria-hidden /><span>{t.title}</span></div>
                <div className="mc-top"><StatusTag task={t} pending={pend} /><span className="grow" /><span className="mono">{t.id.slice(2)}</span></div>
              </button>,
              knob(n),
            ];
          }
          const lines = (logs.get(t.id) ?? []).slice().reverse();
          const liveText = t.live ? plain(ctx.live[t.id]?.filter((x) => x.kind === 'text').at(-1)?.text ?? '', 90) : '';
          // 서버가 준 한국어 now(지금 하는 일)·label을 먼저, 없을 때만 원이름을 바꿔 쓴다
          const lastTool = t.live ? ctx.live[t.id]?.filter((x) => x.kind === 'tool').at(-1) : null;
          const liveTool = lastTool ? (lastTool.now || lastTool.label || toolName(lastTool.name)) : null;
          return [
            <button key={t.id} className={`m-card ${t.live ? 'live' : ''} ${pend ? 'decide' : ''} ${n.done ? 'done' : ''} ${n.res ? 'res' : ''} ${sel ? 'sel' : ''} ${turnCls(n)} ${dimCls(n)}`} style={{ ...style, '--c': color[t.dept] }} onClick={(e) => ctx.pick(t.id, e)} onAuxClick={(e) => ctx.pick(t.id, e)} title={t.title}>
              <div className="mc-top">
                <i className="mc-dot" />
                <StatusTag task={t} pending={pend} since />
                <span className="grow" />
                {t.live && shareOf(t.id) ? <Share x={shareOf(t.id)} /> : <span className="mono">{t.id}</span>}
              </div>
              <div className="mc-title"><i className="mc-st" aria-hidden /><span>{t.title}</span></div>
              {n.res && <div className="mc-res"><span className="mono">결과</span>{resultOf(t) || '—'}</div>}
              {!n.res && <ol className="mc-log">
                {scheduleText(t) && <li><span className="mono">⏰</span>{scheduleText(t)}</li>}
                {lines.map((e) => <li key={`${e.at}:${e.seq}`}><span className="mono">{e.at.slice(11)}</span>{plain(e.text, 80)}</li>)}
                {t.live && (liveText || liveTool) && <li className="now"><span className="mono">지금</span>{liveTool ? `${liveTool} · ` : ''}{liveText}</li>}
                {t.live && t.runtime?.external && !liveText && !liveTool && (t.runtime.step || t.runtime.lastText) && <li className="now"><span className="mono">지금</span>{[t.runtime.step, t.runtime.lastText].filter(Boolean).join(' · ')}</li>}
              </ol>}
              {t.live && t.runtime?.progress && <Progress runtime={t.runtime} compact />}
            </button>,
            knob(n),
          ];
        })}
      </div>

      <div className="map-tools left">
        <button className="iconbtn" onClick={() => zoomBy(1 / 1.3)} title="축소"><span className="mono">−</span></button>
        <span className="mono map-k">{Math.round(cam.k * 100)}%</span>
        <button className="iconbtn" onClick={() => zoomBy(1.3)} title="확대"><Icon name="plus" size={13} /></button>
        <button className="iconbtn" onClick={() => fit()} title="화면에 맞추기"><Icon name="fit" size={13} /></button>
        <button className="btn sm ghost" onClick={() => setAll(true)} title="모든 가지 펼치기">모두 펼치기</button>
        <button className="btn sm ghost" onClick={() => setAll(false)} title="부서까지만 남기고 접기">모두 접기</button>
        <select value={filter ?? ''} onChange={(e) => setFilter(e.target.value || null)} aria-label="부서 거르기">
          <option value="">회사 전체</option>
          {depts.map((d) => <option key={d.name} value={d.name}>{pad(d.order ?? 0)} {d.name}</option>)}
        </select>
        <span className="map-lens" role="group" aria-label="보기">
          {LENSES.map(([k, label, hint]) => (
            <button key={k} className={lens === k ? 'on' : ''} aria-pressed={lens === k} onClick={() => setLens(k)} title={hint}>{label}</button>
          ))}
        </span>
      </div>
      {/* 화면 밖 내 차례 — 누르면 가장 가까운 것으로 카메라가 간다 */}
      {offscreen.map((s) => (
        <button key={`off:${s.side}`} className={`map-turn-edge ${s.side} ${s.wait ? 'wait' : 'answer'}`}
          style={s.side === 'left' || s.side === 'right' ? { top: s.pos } : { left: s.pos }}
          onClick={() => goTo(s.list[0].n)} title={`화면 밖 내 차례 ${s.count}개 — 눌러서 가장 가까운 곳으로`}>
          {s.side === 'left' && <span aria-hidden>←</span>}{s.side === 'top' && <span aria-hidden>↑</span>}
          할 일 {s.count}
          {s.side === 'right' && <span aria-hidden>→</span>}{s.side === 'bottom' && <span aria-hidden>↓</span>}
        </button>
      ))}
      {pilePop && (
        <div className="m-pile-pop" style={{ left: Math.max(8, pilePop.x), top: Math.max(60, pilePop.y) }} role="dialog" aria-label={`${pilePop.title} 쌓인 자료`}>
          <div className="mpp-head">
            <b>{pilePop.title}</b><span className="grow" />
            <button className="mpp-x" onClick={() => setPilePop(null)} aria-label="닫기">×</button>
          </div>
          <div className="mpp-sum mono">보고서 {pilePop.pile.rep} · 문서 {pilePop.pile.doc} · 기억 카드 {pilePop.pile.card}</div>
          <ul>
            {pilePop.pile.items.slice(0, 8).map((it) => (
              <li key={it.id}>
                <button onClick={() => { setPilePop(null); ctx.open(it.id); }} title={it.id}>
                  <em className={`mpp-k ${it.kind}`}>{it.kind === 'rep' ? '보고서' : it.kind === 'card' ? '기억' : '문서'}</em>
                  <span>{it.title}</span>
                  <span className="mono">{String(it.at).slice(5, 10).replace('-', '/')}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="mpp-doc" onClick={() => { setPilePop(null); ctx.pick(pilePop.id); }}>{pilePop.id.startsWith('하위:') ? '하위 항목 문서 열기' : '부서 문서 열기'}</button>
        </div>
      )}
      {allProcs.length > 0 && (
        <button className={`map-procs ${hideStopped ? 'hide' : ''}`} onClick={() => setHideStopped((v) => !v)} aria-pressed={hideStopped}
          title={hideStopped ? '정지 공정 다시 보이기' : '정지 공정 숨기기 (가동 공정만 남김)'}>
          <span className="mono">공정</span>
          <span className="on"><i />가동 {procsOn}</span>
          <span className="off"><b aria-hidden />정지 {allProcs.length - procsOn}</span>
        </button>
      )}
      <div className="map-tools right">
        <span className={`map-live ${paused ? 'paused' : ''}`}>
          <i />{paused ? '일시정지 — 화면을 그대로 둠' : `새 활동 기다리는 중 · 마지막 갱신 ${clock(updatedAt)}`}
        </span>
        <button className="btn sm" onClick={togglePause}><Icon name={paused ? 'play' : 'pause'} size={12} />{paused ? '이어 보기' : '일시정지'}</button>
        <button className={`btn sm ${ctx.state.needsMe ? 'warn' : ''}`} onClick={() => ctx.inspect('inbox')}><Icon name="check" size={12} />전체 확인{ctx.state.needsMe ? ` ${ctx.state.needsMe}` : ''}</button>
      </div>
      {visible.length === 0 && doneToday === 0 && (
        <div className="map-empty">열린 작업이 없어요 — 아래 입력창에서 부서에 일을 맡기면 여기에 카드가 생겨요.</div>
      )}
    </div>
  );
}

function taxNext(tax) {
  const cal = tax?.companies?.[0];
  if (!cal) return Object.assign([], { month: 0 });
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const items = new Map(cal.items.map((it) => [it.id, it]));
  const days = (s) => Math.round((new Date(`${s}T00:00`) - new Date(`${today}T00:00`)) / 86400000);
  const list = cal.events.filter((e) => e.date >= today && !e.done).slice(0, 3)
    .map((e) => ({ key: e.key, date: e.date, dd: days(e.date), name: items.get(e.item)?.짧게 ?? items.get(e.item)?.이름, kind: items.get(e.item)?.분류 }));
  return Object.assign(list, { month: cal.events.filter((e) => e.date.startsWith(today.slice(0, 7))).length });
}
