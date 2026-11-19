import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribe } from './api.js';
import { linkTarget } from './util.js';
import { TopBar } from './TopBar.jsx';
import { Sidebar } from './Sidebar.jsx';
import { StatusBar } from './StatusBar.jsx';
import { Overview } from './Overview.jsx';
import { Desk } from './Desk.jsx';
import { useSessions, liveSessions } from './useSessions.js';
import { SynapseField } from './SynapseField.jsx';
import { DocPage } from './DocPage.jsx';
import { setLinkInfo } from './Markdown.jsx';
import { BoardView } from './BoardView.jsx';
import { TimelineView } from './TimelineView.jsx';
import { TaxCalendar } from './TaxCalendar.jsx';
import { CommandBar } from './CommandBar.jsx';
import { Palette } from './Palette.jsx';
import { PreviewPopover } from './Preview.jsx';
import { TabBar } from './TabBar.jsx';
import { Inspector } from './Inspector.jsx';

// 그래프(WebGL)는 열 때만 불러온다
const GraphView = lazy(() => import('./GraphView.jsx').then((m) => ({ default: m.GraphView })));
const MapView = lazy(() => import('./MapView.jsx').then((m) => ({ default: m.MapView })));

// 주소: #/ 데스크  #/dept/비서(데스크를 부서로 거름)  #/doc/W-261030-001  #/map  #/board  #/timeline  #/memory(기억 = 그래프 보기, #/graph도 됨)
//   #/overview  예전 개요 (남겨 둠)
//   + ?p=W-261030-004  오른쪽 패널에 연 작업 (가운데 보기와 같이 뜬다)  ?p=cc:<세션 id>  작업 기록 전 바깥 세션(읽기 전용)
//   ?p=inbox  결재함 · ?p=activity  PC 작업 (P0에선 그대로 둔다)
function parseRoute() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const h = decodeURIComponent(path);
  const panel = new URLSearchParams(query).get('p') || null;
  const [view0, ...rest] = h.split('/');
  const view = view0 === 'memory' ? 'graph' : view0;   // 기억 = 그래프 보기
  const arg = rest.join('/') || null;
  const r = view === 'doc' && arg ? { view: 'doc', name: arg }
    : view === 'dept' && arg ? { view: 'desk', dept: arg }
      : ['graph', 'board', 'timeline', 'map', 'calendar', 'overview'].includes(view) ? { view, dept: arg }
        : { view: 'desk' };
  return { ...r, panel };
}
const toHash = (r) => (r.view === 'doc' ? `#/doc/${encodeURIComponent(r.name)}`
  : ['graph', 'board', 'timeline', 'map', 'calendar', 'overview'].includes(r.view) ? `#/${r.view === 'graph' ? 'memory' : r.view}${r.dept ? `/${encodeURIComponent(r.dept)}` : ''}`
    : r.dept ? `#/dept/${encodeURIComponent(r.dept)}` : '#/') + (r.panel ? `?p=${encodeURIComponent(r.panel)}` : '');

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 됨 */ } },
};

export function App() {
  const [state, setState] = useState(null);
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  // 해시 없이 들어오면 데스크(#/). #/map·#/doc/… 같은 직접 주소는 그대로 (새로고침해도 유지)
  const [route, setRoute] = useState(() => {
    if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/');
    return parseRoute();
  });
  const desk = useSessions();
  const [live, setLive] = useState({});
  const [tick, setTick] = useState(0);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState(() => store.get('brain.theme', 'dark'));
  const [sideOff, setSideOff] = useState(false);
  const [preview, setPreview] = useState(null);   // { name, x, y } — Ctrl+마우스 미리보기
  const [panelW, setPanelW] = useState(() => Number(store.get('brain.panel.w', 440)) || 440);
  useEffect(() => { store.set('brain.panel.w', String(panelW)); }, [panelW]);
  const cmdRef = useRef(null);

  useEffect(() => { document.documentElement.dataset.theme = theme; store.set('brain.theme', theme); }, [theme]);
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // 보기를 바꿔도 오른쪽 패널은 그대로 둔다 (panel을 따로 주면 그것으로)
  const routeRef = useRef(route);
  routeRef.current = route;
  const go = useCallback((r) => { location.hash = toHash({ panel: routeRef.current.panel, ...r }); }, []);
  const inspect = useCallback((id) => { location.hash = toHash({ ...routeRef.current, panel: id }); }, []);
  const closePanel = useCallback(() => { location.hash = toHash({ ...routeRef.current, panel: null }); }, []);

  // 문서 탭: 그냥 열면 지금 탭을 바꾸고, Ctrl(⌘)·가운데 클릭이면 새 탭 (옵시디언과 같음)
  const [tabs, setTabs] = useState(() => { try { return JSON.parse(store.get('brain.tabs', '[]')); } catch { return []; } });
  const lastTab = useRef(null);
  const newTab = useRef(false);
  useEffect(() => { store.set('brain.tabs', JSON.stringify(tabs)); }, [tabs]);
  const docName = route.view === 'doc' ? route.name : null;
  useEffect(() => {
    if (!docName) return;
    const name = docName;
    setTabs((t) => {
      if (t.includes(name)) return t;
      const i = t.indexOf(lastTab.current);
      if (newTab.current || i < 0) return i < 0 ? [...t, name] : [...t.slice(0, i + 1), name, ...t.slice(i + 1)];
      return t.map((x, j) => (j === i ? name : x));
    });
    newTab.current = false;
    lastTab.current = name;
    // 팔레트의 최근 문서 (8개)
    try { store.set('brain.recent', JSON.stringify([name, ...JSON.parse(store.get('brain.recent', '[]')).filter((x) => x !== name)].slice(0, 8))); } catch { /* 저장 못 해도 됨 */ }
  }, [docName]);
  const open = useCallback((name, opts = {}) => { newTab.current = !!opts.newTab; go({ view: 'doc', name }); }, [go]);
  // 작업을 누르면: 그냥은 오른쪽 패널에, Ctrl(⌘)이면 문서 탭으로
  const pick = useCallback((id, e) => { if (e?.ctrlKey || e?.metaKey || e?.button === 1) open(id, { newTab: true }); else inspect(id); }, [open, inspect]);
  const closeTab = useCallback((name) => {
    setTabs((t) => {
      const i = t.indexOf(name);
      const rest = t.filter((x) => x !== name);
      if (route.view === 'doc' && route.name === name) {
        const next = rest[Math.max(0, i - 1)];
        lastTab.current = next ?? null;
        setTimeout(() => go(next ? { view: 'doc', name: next } : { view: 'desk' }), 0);
      }
      return rest;
    });
  }, [route, go]);

  const refresh = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([api.state(), api.graph()]);
      setLinkInfo(g.nodes);   // [[ID]] 링크에 문서 이름을 붙이려고 (그리기 전에)
      setState(s); setGraph(g); setError(null);
    } catch (e) { setError(e.message); }
  }, []);

  const timer = useRef(null);
  const soon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { refresh(); setTick((t) => t + 1); }, 220);
  }, [refresh]);

  useEffect(() => {
    refresh();
    return subscribe((event, data) => {
      if (event === 'open') { setConnected(true); soon(); return; }
      if (event === 'error') { setConnected(false); return; }
      if (event === 'text' || event === 'tool') {
        // tool 사건은 서버가 한국어 label(도구 이름)·now(지금 하는 일 한 줄)를 같이 준다
        setLive((l) => ({ ...l, [data.id]: [...(l[data.id] ?? []).slice(-30), { kind: event, text: data.text, name: data.name, label: data.label, now: data.now, at: Date.now() }] }));
        if (event === 'tool') soon();
        return;
      }
      if (event === 'result') setLive((l) => { const { [data.id]: _, ...rest } = l; return rest; });
      soon();
    });
  }, [refresh, soon]);

  // 단축키: Ctrl+K 팔레트, Ctrl+\ 사이드바, Alt+1~5 보기 (데스크·지도·보드·기록·기억), Ctrl+. 패널
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); setPalette((v) => !v); }
      else if ((e.ctrlKey || e.metaKey) && k === '\\') { e.preventDefault(); setSideOff((v) => !v); }
      else if (e.altKey && ['1', '2', '3', '4', '5'].includes(k)) { e.preventDefault(); go({ view: ['desk', 'map', 'board', 'timeline', 'graph'][+k - 1], dept: route.dept }); }
      else if ((e.ctrlKey || e.metaKey) && k === '.') { e.preventDefault(); if (routeRef.current.panel) closePanel(); else inspect('inbox'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, route.dept, closePanel, inspect]);

  const ctx = useMemo(() => {
    if (!state) return null;
    const pendingByTask = {};
    for (const d of state.pending) (pendingByTask[linkTarget(d.task)] ??= []).push(d);
    return {
      state, graph, live, tick, go, open, refresh, route, inspect, closePanel, pick,
      // 데스크: 세션 통합 조회 · 내 차례 · 칩 글 (5초 + 서버 사건)
      sessions: desk.sessions, attention: desk.attention, chips: desk.chips, reloadSessions: desk.soon,
      deptColor: Object.fromEntries(state.depts.map((d) => [d.name, d.color])),
      pendingByTask,
      focusCommand: () => cmdRef.current?.focus(),
      openPalette: () => setPalette(true),
      preview: (name, x, y) => setPreview((p) => (p?.name === name ? p : { name, x, y })),
      hidePreview: () => setPreview(null),
    };
  }, [state, graph, live, tick, go, open, refresh, route, inspect, closePanel, pick, desk.sessions, desk.attention, desk.chips, desk.soon]);

  // 페이지가 바뀌거나 Esc면 미리보기를 닫는다
  useEffect(() => { setPreview(null); }, [route.view, route.name, route.dept]);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  if (!ctx) {
    return <div className="boot">{error ? <>서버에 연결할 수 없음 — {error}<br />app 폴더에서 npm start</> : '불러오는 중…'}</div>;
  }

  const dept = route.dept ?? null;
  return (
    <div className={`shell ${sideOff ? 'side-off' : ''} ${route.panel ? 'has-panel' : ''}`} style={{ '--panel-w': `${panelW}px` }}>
      <TopBar ctx={ctx} onSearch={() => setPalette(true)} />
      <Sidebar ctx={ctx} onToggle={() => setSideOff((v) => !v)} />
      <main className="main">
        {/* 시냅스 망은 앱에 하나 — 탭을 옮겨도 같은 망, 같은 신호가 이어서 흐른다. 지도·기억은 자기 그림이 있어 숨김 */}
        <SynapseField depts={state?.depts ?? []} sessions={liveSessions(ctx.sessions ?? [])} off={route.view === 'map' || route.view === 'graph' || route.view === 'doc'} />
        <TabBar ctx={ctx} tabs={tabs} active={route.view === 'doc' ? route.name : null} onClose={closeTab} />
        {route.view === 'map' ? (
          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}><Suspense fallback={<div className="boot">지도 불러오는 중…</div>}><MapView ctx={ctx} dept={dept} /></Suspense></div>
        ) : route.view === 'graph' ? (
          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}><Suspense fallback={<div className="boot">기억 불러오는 중…</div>}><GraphView ctx={ctx} dept={dept} /></Suspense></div>
        ) : (
          <div className="scroll" key={`${route.view}:${route.name ?? dept ?? ''}`}>
            {route.view === 'doc' ? <DocPage name={route.name} ctx={ctx} />
              : route.view === 'board' ? <BoardView ctx={ctx} dept={dept} />
                : route.view === 'timeline' ? <TimelineView ctx={ctx} dept={dept} />
                : route.view === 'calendar' ? <TaxCalendar ctx={ctx} />
                : route.view === 'overview' ? <Overview ctx={ctx} dept={dept} />
                : <Desk ctx={ctx} dept={dept} />}
          </div>
        )}
        <CommandBar ref={cmdRef} ctx={ctx} dept={dept} />
      </main>
      {route.panel && <Inspector key={route.panel} id={route.panel} ctx={ctx} onResize={setPanelW} width={panelW} />}
      <StatusBar ctx={ctx} connected={connected} theme={theme} onTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
      {palette && <Palette ctx={ctx} onClose={() => setPalette(false)} />}
      {preview && <PreviewPopover at={preview} ctx={ctx} onClose={() => setPreview(null)} />}
    </div>
  );
}
