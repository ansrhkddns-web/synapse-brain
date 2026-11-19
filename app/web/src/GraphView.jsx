// 기억 — 옵시디언 그래프 보기와 같은 기능(필터 · 색 그룹 · 표시 · 힘 · 애니메이트)에
//   왼쪽 면 필터(문서 종류·부서·태그 개수)와 "기억에 질문하기"(읽기 전용 세션이 찾아 답하고 근거 점에 고리)를 더했다
//   탭: 한눈에(최근 기억 시간줄·기억 카드 요약·문서 모아 보기, MemoryHome) · 그래프 · 기억 카드
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { createGraph, DEFAULTS } from './graph/engine.js';
import { buildData, defaultGroups, FILTER_DEFAULTS, groupCss, readColors } from './graph/data.js';
import { Icon } from './icons.jsx';
import { Markdown } from './Markdown.jsx';
import { MemoryCards } from './MemoryCards.jsx';
import { MemoryHome } from './MemoryHome.jsx';
import { LearnView } from './LearnView.jsx';
import { STATUS } from './util.js';

// 기억 탭: [열쇠, 이름, 아이콘, 한 줄 설명]
const MEM_TABS = [
  ['home', '한눈에', 'clock', '기억 정리 — 필요한 것(지금·기준·결과)과 흔적을 나누고, 출처와 무게를 함께'],
  ['graph', '그래프', 'graph', '모든 문서와 연결을 점과 선으로 — 점을 누르면 오른쪽에 열려요'],
  ['cards', '기억 카드', 'bolt', '사람이 승인한 판단 기준 — 세션 지시문에 붙어요'],
  ['learn', '배움', 'edit', '일하다 알게 된 것 — 모이면 스킬로 만들어요'],
];
const FIRST_TAB = 'home';
const TAB_KEY = 'brain.memory.tab';

// 설정 형식이 바뀌어 새 키로 (옛 값은 버림)
const KEY = 'brain.graph.v3';   // v3: 비서실장 가운데·깊이 고리(퍼지기) 기본
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 저장 못 해도 됨 */ } };

export function GraphView({ ctx, dept }) {
  const host = useRef(null);
  const engine = useRef(null);
  const [ready, setReady] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [tip, setTip] = useState(null);
  const [fps, setFps] = useState(0);
  const saved = useMemo(load, []);
  // 다른 곳(태그 칩 등)에서 넘겨준 검색어가 있으면 그것부터
  const handed = (() => { try { const q = sessionStorage.getItem('brain.graph.q'); sessionStorage.removeItem('brain.graph.q'); return q; } catch { return null; } })();
  const [filters, setFilters] = useState({ ...FILTER_DEFAULTS, ...saved.filters, search: handed ?? (dept ? `dept:${dept}` : ''), ...(handed?.startsWith('tag:') ? { tags: true } : {}) });
  const [display, setDisplay] = useState({ ...DEFAULTS, ...saved.display });
  // 그룹은 사용자가 고친 그대로 저장한다 (처음엔 기본 규칙)
  const [groups, setGroups] = useState(() => (Array.isArray(saved.groups) && saved.groups.length ? saved.groups : defaultGroups(ctx.state)));
  const [panel, setPanel] = useState(saved.panel ?? true);
  const [open, setOpen] = useState(saved.open ?? { filters: true, groups: true, display: true, forces: false });
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => { setFilters((f) => ({ ...f, search: dept ? `dept:${dept}` : '' })); }, [dept]);
  useEffect(() => {
    save({ filters: { ...filters, search: '' }, display, groups, panel, open });
  }, [filters, display, groups, panel, open]);

  useEffect(() => {
    let alive = true;
    let eng = null;
    createGraph(host.current, {
      colors: readColors(),
      settings: display,
      onHover: (t) => {
        setTip(t);
        if (t?.ctrl && t.node.type !== '태그') {
          const r = host.current.getBoundingClientRect();
          ctxRef.current.preview(t.node.type === '유령' ? t.node.title : t.node.id, r.left + t.x, r.top + t.y);
        }
      },
      // 누르면 오른쪽 패널에, Ctrl+클릭은 새 탭 전체 화면으로
      onOpen: (n, e) => { if (n.type !== '유령' && n.type !== '태그') ctxRef.current.pick(n.id, e); },
    }).then((e) => {
      if (!alive) { e.destroy(); return; }
      eng = e; engine.current = e; e.onFps(setFps); setReady(true);
    });
    const mo = new MutationObserver(() => engine.current?.setColors(readColors()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { alive = false; mo.disconnect(); eng?.destroy(); engine.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => (ctx.graph ? buildData(ctx.graph, ctx.state, { filters, groups, colors: readColors() }) : null), [ctx.graph, ctx.state, filters, groups]);
  useEffect(() => { if (ready && data) { engine.current.setData(data); setDrawn(true); } }, [ready, data]);
  useEffect(() => { if (ready) engine.current.setSettings(display); }, [ready, display]);
  // 마지막에 본 탭을 기억한다 (처음엔 한눈에)
  const [tab, setTab] = useState(() => { try { const t = localStorage.getItem(TAB_KEY); return MEM_TABS.some(([k]) => k === t) ? t : FIRST_TAB; } catch { return FIRST_TAB; } });
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* 없어도 됨 */ } }, [tab]);
  useEffect(() => { if (ready) engine.current.pause(tab !== 'graph'); }, [ready, tab]);
  const [answer, setAnswer] = useState(null);   // { question, answer, sources } | { loading } | { error }
  // 오른쪽 패널에 열린 문서 = 고른 점: 빛나고, 이웃으로 시냅스가 흐른다
  useEffect(() => { if (ready) engine.current.setSelected(ctx.route.panel); }, [ready, data, ctx.route.panel]);
  useEffect(() => { if (ready) engine.current.setMarks(answer?.sources?.map((s) => s.id) ?? []); }, [ready, answer]);

  const setD = (k) => (e) => setDisplay((d) => ({ ...d, [k]: typeof d[k] === 'boolean' ? e.target.checked : Number(e.target.value) }));
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: typeof f[k] === 'boolean' ? e.target.checked : e.target.value }));
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const counts = data ? `보이는 점 ${data.nodes.length} · 선 ${data.links.length}` : '';
  const all = ctx.graph?.nodes ?? [];
  const memCount = all.filter((n) => n.type !== '태그' && n.type !== '유령').length;
  const setSearch = (q) => setFilters((f) => ({ ...f, search: f.search === q ? '' : q }));
  const cardCount = all.filter((n) => n.type === '기억카드').length;

  return (
    <div className="graph">
      <div ref={host} className={`graph-canvas ${drawn ? 'in' : ''}`} />
      {!drawn && <div className="boot" style={{ position: 'absolute', inset: 0 }}>기억 배치 중…</div>}

      <div className="graph-hud">
        <div className="eyebrow"><span className="ebox" />기억 · <b>{dept ?? '전체'}</b></div>
        {tab === 'graph' && <div className="mem-count"><b>점 {memCount.toLocaleString()}</b> · 연결 {(ctx.graph?.edges.length ?? 0).toLocaleString()}</div>}
        <div className="seg mem-tabs" role="tablist">
          {MEM_TABS.map(([k, label, icon, hint]) => (
            <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)} title={hint}>
              <Icon name={icon} size={12} />{label}{k === 'cards' && cardCount ? <span className="mono">{cardCount}</span> : null}
            </button>
          ))}
        </div>
        {tab === 'graph' && <div className="mem-tab-hint">{MEM_TABS[1][3]}</div>}
        {tab === 'graph' && <div className="graph-sub">{counts} · {fps} fps</div>}
        {tab === 'graph' && <Facets nodes={all} search={filters.search} onPick={setSearch} />}
      </div>

      {tab === 'graph' && <Ask ctx={ctx} answer={answer} setAnswer={setAnswer} />}
      {tab === 'home' && <div className="mem-pane"><MemoryHome ctx={ctx} setTab={setTab} /></div>}
      {tab === 'cards' && <div className="mem-pane"><MemoryCards ctx={ctx} /></div>}
      {tab === 'learn' && <div className="mem-pane"><LearnView ctx={ctx} /></div>}

      <div className="gpanel-wrap" style={tab !== 'graph' ? { display: 'none' } : undefined}>
        {!panel && <button className="gicon solo" onClick={() => setPanel(true)} title="그래프 설정"><Icon name="filter" /></button>}
        {panel && (
          <div className="gpanel">
            <div className="gp-top">
              <button className="gicon" onClick={() => engine.current?.animate()} title="Animate — 만든 순서대로 다시 그리기"><Icon name="play" /></button>
              <button className="gicon" onClick={() => engine.current?.fit()} title="전체 보기"><Icon name="fit" /></button>
              <span className="grow" />
              <button className="gicon" onClick={() => setPanel(false)} title="닫기"><Icon name="x" /></button>
            </div>

            <Section title="Filters" open={open.filters} onToggle={() => toggle('filters')}>
              <input className="gp-search" value={filters.search} onChange={setF('search')} placeholder="파일 찾기… (path: tag: dept: status:)" spellCheck={false} />
              <Toggle label="태그" checked={filters.tags} onChange={setF('tags')} />
              <Toggle label="없는 문서 (유령 링크)" checked={filters.ghosts} onChange={setF('ghosts')} />
              <Toggle label="고아 (연결 없음)" checked={filters.orphans} onChange={setF('orphans')} />
            </Section>

            <Section title="Groups" open={open.groups} onToggle={() => toggle('groups')}>
              {groups.map((g) => {
                const patch = (v) => setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, ...v } : x)));
                return (
                  <div key={g.id} className="gp-group">
                    <input type="checkbox" checked={g.on} onChange={() => patch({ on: !g.on })} title="켜기/끄기" />
                    <label className="gp-sw" style={{ background: groupCss(g), position: 'relative' }} title="색 고르기">
                      <input type="color" className="gp-color" style={{ opacity: 0, position: 'absolute', inset: 0 }} value={g.color.startsWith('#') ? g.color : '#8c9bff'} onChange={(e) => patch({ color: e.target.value })} />
                    </label>
                    <input className="gp-qin" value={g.query} onChange={(e) => patch({ query: e.target.value })} placeholder="path: tag: dept: status:" spellCheck={false} />
                    <button className="gp-del" onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))} title="그룹 지우기"><Icon name="x" size={11} /></button>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="gp-btn" style={{ flex: 1 }} onClick={() => setGroups((gs) => [...gs, { id: `g-${Date.now()}`, query: '', color: '#5fe6ff', on: true }])}><Icon name="plus" size={12} />새 그룹</button>
                <button className="gp-btn ghost" onClick={() => setGroups(defaultGroups(ctx.state))}>기본</button>
              </div>
              <div className="gp-hint">위에서부터 처음 맞는 그룹 색. 검색 문법: path: file: tag: dept: status:running·decision·검수 type: -빼기 OR</div>
            </Section>

            <Section title="Display" open={open.display} onToggle={() => toggle('display')}>
              <Toggle label="화살표" checked={display.arrows} onChange={setD('arrows')} />
              <Slider label="이름표가 나타나는 거리" min={-3} max={3} step={0.1} value={display.textFade} onChange={setD('textFade')} />
              <Slider label="점 크기" min={0.3} max={3} step={0.05} value={display.nodeSize} onChange={setD('nodeSize')} />
              <Slider label="선 굵기" min={0.3} max={4} step={0.05} value={display.linkThickness} onChange={setD('linkThickness')} />
              <button className="gp-btn" onClick={() => engine.current?.animate()}><Icon name="play" size={13} />다시 흔들기</button>
            </Section>

            <Section title="Forces" open={open.forces} onToggle={() => toggle('forces')}>
              <Slider label="Center force" min={0} max={1} step={0.01} value={display.center} onChange={setD('center')} />
              <Slider label="Repel force" min={0} max={20} step={0.1} value={display.repel} onChange={setD('repel')} />
              <Slider label="Link force" min={0} max={1} step={0.01} value={display.linkForce} onChange={setD('linkForce')} />
              <Slider label="Link distance" min={30} max={500} step={1} value={display.linkDistance} onChange={setD('linkDistance')} />
              <Toggle label="깊이 고리로 퍼지기" checked={display.radial} onChange={setD('radial')} />
              <button className="gp-btn ghost" onClick={() => setDisplay({ ...DEFAULTS })}>기본값으로</button>
            </Section>
          </div>
        )}
      </div>

      {tip && (
        <div className="graph-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="mono">{tip.node.type} · {tip.node.degree} links{tip.node.bytes ? ` · ${(tip.node.bytes / 1024).toFixed(1)} KB` : ''}</div>
          <b>{tip.node.title}</b>
          <small>
            {tip.node.live ? 'running' : tip.node.deciding ? '결정 필요' : tip.node.status ? STATUS[tip.node.status]?.label ?? tip.node.status : ''}
            {tip.node.dept ? ` · ${tip.node.dept}` : ''}{tip.node.file ? ` · ${tip.node.file}` : ''}
          </small>
        </div>
      )}
    </div>
  );
}

function Section({ title, open, onToggle, children }) {
  return (
    <div className="gp-sec">
      <button className="gp-head" onClick={onToggle}><Icon name="chev" size={12} className={`chev ${open ? 'open' : ''}`} />{title}</button>
      {open && <div className="gp-body">{children}</div>}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="gp-row">
      <span>{label}</span>
      <input type="checkbox" className="switch" checked={checked} onChange={onChange} />
    </label>
  );
}

function Slider({ label, ...p }) {
  return (
    <label className="gp-slider">
      <span>{label}<em>{Number(p.value).toFixed(p.step < 1 ? 2 : 0)}</em></span>
      <input type="range" {...p} />
    </label>
  );
}

// 왼쪽 면 필터: 누르면 그 조건으로 거르고, 다시 누르면 푼다
const TYPE_ORDER = ['총괄', '부서', '하위', '공정', '작업', '결정', '보고서', '기억카드', '주인말', '검수판정', '세션지시', '배움', '일지', '지표', '노트', '폴더', '참고'];
const TYPE_LABEL = { 총괄: '관제실', 하위: '하위 항목', 노트: '공통 규칙', 폴더: '참고 폴더', 참고: '참고 문서', 주인말: '주인 말', 검수판정: '검수 판정', 세션지시: '세션 지시', 기억카드: '기억 카드' };
function Facets({ nodes, search, onPick }) {
  const by = (key) => {
    const m = new Map();
    for (const n of nodes) for (const v of [].concat(key(n) ?? [])) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const types = by((n) => (n.type === '태그' || n.type === '유령' ? null : n.type));
  const depts = by((n) => (n.type === '태그' || n.type === '유령' ? null : n.dept));
  const tags = [...by((n) => n.tags ?? []).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const Row = ({ q, label, n, dot }) => (
    <button className={`facet ${search === q ? 'on' : ''}`} onClick={() => onPick(q)} title={q}>
      {dot && <i style={{ '--c': dot }} />}<span>{label}</span><em>{n.toLocaleString()}</em>
    </button>
  );
  return (
    <div className="facets">
      <div className="facet-h">문서 종류</div>
      {TYPE_ORDER.filter((t) => types.has(t)).map((t) => <Row key={t} q={`type:${t}`} label={TYPE_LABEL[t] ?? t} n={types.get(t)} />)}
      <div className="facet-h">부서</div>
      {[...depts.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => <Row key={d} q={`dept:${d}`} label={d} n={n} />)}
      {tags.length > 0 && <div className="facet-h">태그</div>}
      {tags.map(([t, n]) => <Row key={t} q={`tag:${t}`} label={`#${t}`} n={n} />)}
    </div>
  );
}

// 기억에 질문하기: 보관함·참고 문서를 읽기만 하는 세션이 찾아 답한다
function Ask({ ctx, answer, setAnswer }) {
  const [q, setQ] = useState('');
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!answer?.loading) return undefined;
    const t0 = Date.now();
    const t = setInterval(() => setSec(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [answer?.loading]);
  const go = async () => {
    const text = q.trim();
    if (!text || answer?.loading) return;
    setAnswer({ loading: true, question: text });
    setSec(0);
    try { setAnswer(await api.ask(text)); } catch (e) { setAnswer({ error: e.message, question: text }); }
  };
  return (
    <div className="ask">
      <div className="ask-in">
        <Icon name="search" size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) go(); if (e.key === 'Escape') setAnswer(null); }}
          placeholder="기억에 질문해 보세요… (예: 몬티 E023은 지금 어떤 상태야?)" aria-label="기억에 질문하기" />
        {answer && !answer.loading && <button className="iconbtn" onClick={() => setAnswer(null)} title="답 닫기 (Esc)"><Icon name="x" size={13} /></button>}
      </div>
      {!answer && <div className="ask-hint">질문하면 기록을 찾아 근거와 함께 설명해요 — 읽기만 하고 아무것도 고치지 않아요</div>}
      {answer?.loading && <div className="ask-card"><div className="ask-status"><span className="typing"><i /><i /><i /></span>기록을 찾는 중 · {sec}초</div></div>}
      {answer?.error && <div className="ask-card"><div className="ask-status err">{answer.error}</div></div>}
      {answer?.answer && (
        <div className="ask-card">
          <div className="ask-q">{answer.question}</div>
          <div className="ask-a"><Markdown className="small" text={answer.answer} refs={answer.refs} onOpen={(id, o) => (o?.newTab ? ctx.open(id, o) : ctx.inspect(id))} onPreview={ctx.preview} /></div>
          {answer.sources.length > 0 && (
            <div className="ask-src">
              <div className="facet-h">근거 {answer.sources.length} — 지도에 고리로 표시</div>
              {answer.sources.map((s) => (
                <button key={s.id} className="facet" onClick={(e) => ctx.pick(s.id, e)} title={s.id}><span>{s.title}</span><em>{s.type === '참고' ? 'md' : s.type === '폴더' ? 'dir' : s.type}</em></button>
              ))}
            </div>
          )}
          <div className="ask-meta mono">{(answer.ms / 1000).toFixed(1)}초 · {answer.turns}턴{answer.cost ? ` · $${answer.cost.toFixed(3)}` : ''}</div>
        </div>
      )}
    </div>
  );
}
