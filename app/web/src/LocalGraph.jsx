// 로컬 그래프 — 옵시디언처럼 지금 문서와 그 이웃만. 깊이 1~5, 들어오는/나가는/이웃끼리 링크 켜기·끄기
import { useEffect, useMemo, useRef, useState } from 'react';
import { createGraph } from './graph/engine.js';
import { buildData, defaultGroups, FILTER_DEFAULTS, LOCAL_DEFAULTS, localData, readColors } from './graph/data.js';
import { Icon } from './icons.jsx';

const KEY = 'brain.localgraph';
const load = () => { try { return { ...LOCAL_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...LOCAL_DEFAULTS }; } };

export function LocalGraph({ ctx, center }) {
  const host = useRef(null);
  const engine = useRef(null);
  const [ready, setReady] = useState(false);
  const [opt, setOpt] = useState(load);
  const [showOpt, setShowOpt] = useState(false);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch { /* 저장 못 해도 됨 */ } }, [opt]);

  useEffect(() => {
    let alive = true;
    let eng = null;
    createGraph(host.current, {
      colors: readColors(),
      compact: true,
      settings: { textFade: -1, radial: false },
      onOpen: (n) => { if (n.type !== '유령' && n.type !== '태그' && n.id !== center) ctxRef.current.open(n.id); },
      onHover: (t) => {
        if (t?.ctrl && t.node.type !== '태그') {
          const r = host.current.getBoundingClientRect();
          ctxRef.current.preview(t.node.type === '유령' ? t.node.title : t.node.id, r.left + t.x, r.top + t.y);
        }
      },
    }).then((e) => { if (!alive) { e.destroy(); return; } eng = e; engine.current = e; setReady(true); });
    const mo = new MutationObserver(() => engine.current?.setColors(readColors()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { alive = false; mo.disconnect(); eng?.destroy(); engine.current = null; };
  }, [center]);

  const data = useMemo(() => {
    if (!ctx.graph) return null;
    let groups = defaultGroups(ctx.state);
    try { const g = JSON.parse(localStorage.getItem('brain.graph.v3') ?? '{}').groups; if (Array.isArray(g) && g.length) groups = g; } catch { /* 기본 그룹 */ }
    const full = buildData(ctx.graph, ctx.state, { filters: { ...FILTER_DEFAULTS, tags: true }, groups, colors: readColors() });
    return localData(full, center, opt);
  }, [ctx.graph, ctx.state, center, opt]);

  useEffect(() => { if (ready && data) engine.current.setData(data, { focus: center }); }, [ready, data, center]);

  const set = (k) => (e) => setOpt((o) => ({ ...o, [k]: k === 'depth' ? Number(e.target.value) : e.target.checked }));
  return (
    <div className="aside-box">
      <div className="aside-title">
        <span>연결 그래프 · {data?.nodes.length ?? 0}</span>
        <span className="depth">
          <button className={showOpt ? 'on' : ''} onClick={() => setShowOpt((v) => !v)} title="로컬 그래프 설정"><Icon name="filter" size={11} /></button>
          <button onClick={() => ctx.go({ view: 'graph' })} title="전체 그래프"><Icon name="graph" size={11} /></button>
        </span>
      </div>
      {showOpt && (
        <div className="localctl">
          <label className="gp-slider"><span>깊이<em>{opt.depth}</em></span><input type="range" min={1} max={5} step={1} value={opt.depth} onChange={set('depth')} /></label>
          <label className="gp-row"><span>들어오는 링크</span><input type="checkbox" className="switch" checked={opt.incoming} onChange={set('incoming')} /></label>
          <label className="gp-row"><span>나가는 링크</span><input type="checkbox" className="switch" checked={opt.outgoing} onChange={set('outgoing')} /></label>
          <label className="gp-row"><span>이웃끼리 링크</span><input type="checkbox" className="switch" checked={opt.neighbors} onChange={set('neighbors')} /></label>
        </div>
      )}
      <div ref={host} className="localgraph" />
    </div>
  );
}
