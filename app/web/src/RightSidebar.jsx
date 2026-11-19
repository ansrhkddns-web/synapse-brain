// 오른쪽 사이드바 — 옵시디언처럼: 로컬 그래프 + 연결(역링크·링크 없는 언급·나가는 링크) · 개요(제목) · 태그
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Kind } from './TaskBits.jsx';
// 로컬 그래프(WebGL)는 따로 불러와서 첫 화면을 가볍게
const LocalGraph = lazy(() => import('./LocalGraph.jsx').then((m) => ({ default: m.LocalGraph })));
import { OPEN_STATUSES } from './util.js';

const KEY = 'brain.rightpane';

export function RightSidebar({ ctx, doc, name }) {
  const [pane, setPane] = useState(() => { try { return localStorage.getItem(KEY) || 'links'; } catch { return 'links'; } });
  useEffect(() => { try { localStorage.setItem(KEY, pane); } catch { /* 저장 못 해도 됨 */ } }, [pane]);
  const center = name === 'CLAUDE' ? 'CLAUDE' : name;

  return (
    <aside className="rside">
      <Suspense fallback={<div className="aside-box"><div className="aside-title"><span>연결 그래프</span></div><div className="localgraph" /></div>}><LocalGraph ctx={ctx} center={center} /></Suspense>
      <div className="rtabs" role="tablist">
        <button role="tab" className={pane === 'links' ? 'on' : ''} onClick={() => setPane('links')} title="연결"><Icon name="link" size={13} />연결</button>
        <button role="tab" className={pane === 'outline' ? 'on' : ''} onClick={() => setPane('outline')} title="개요"><Icon name="doc" size={13} />개요</button>
        <button role="tab" className={pane === 'tags' ? 'on' : ''} onClick={() => setPane('tags')} title="태그"><Icon name="filter" size={13} />태그</button>
      </div>
      {pane === 'links' && <Links ctx={ctx} doc={doc} name={center} />}
      {pane === 'outline' && <Outline body={doc.body} />}
      {pane === 'tags' && <Tags ctx={ctx} name={center} />}
    </aside>
  );
}

function Row({ n, ctx, sub }) {
  const done = (n.type === '작업' && !OPEN_STATUSES.includes(n.status)) || (n.type === '결정' && n.status === '결정됨');
  const ghost = n.type === '유령';
  return (
    <button
      className={`linkrow ${ghost ? 'ghost' : ''}`}
      onClick={(e) => !ghost && ctx.open(n.id, { newTab: e.ctrlKey || e.metaKey })}
      onMouseOver={(e) => (e.ctrlKey || e.metaKey) && !ghost && ctx.preview(n.id, e.clientX, e.clientY)}
      title={ghost ? '아직 없는 문서' : n.title}
    >
      <Kind type={n.type} color={ctx.deptColor[n.dept]} done={done} decide={n.type === '결정' && n.status === '대기'} />
      <span className="tname">{n.title}{sub && <small>{sub}</small>}</span>
      <span className="mono">{ghost ? 'unresolved' : n.type === '폴더' ? 'dir' : n.type === '참고' ? 'md' : n.id.replace(/^부서:/, '')}</span>
    </button>
  );
}

function Group({ title, count, children, empty = '—' }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rgroup">
      <button className="rgroup-h" onClick={() => setOpen((v) => !v)}>
        <Icon name="chev" size={11} className={`chev ${open ? 'open' : ''}`} />{title}<span className="mono">{count}</span>
      </button>
      {open && (count ? children : <div className="rempty">{empty}</div>)}
    </div>
  );
}

function Links({ ctx, doc, name }) {
  const nodes = ctx.graph?.nodes ?? [];
  const edges = ctx.graph?.edges ?? [];
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const me = byId.get(name);
  const parent = me?.parent && me.parent !== 'me' ? byId.get(me.parent) : null;
  const children = nodes.filter((n) => n.parent === name && n.type !== '유령' && n.type !== '태그');
  const outgoing = edges.filter((e) => e.source === name && e.kind !== 'tag' && e.kind !== 'tree').map((e) => byId.get(e.target)).filter(Boolean);
  const incoming = edges.filter((e) => e.target === name && e.kind !== 'tag' && e.kind !== 'tree').map((e) => byId.get(e.source)).filter(Boolean);

  // 링크 없는 언급: 제목을 본문에 적었지만 [[링크]]는 안 건 문서 (옵시디언 Unlinked mentions)
  const [unlinked, setUnlinked] = useState([]);
  const title = doc.data?.title;
  useEffect(() => {
    let alive = true;
    if (!title || title.length < 2) { setUnlinked([]); return undefined; }
    api.search(title).then((hits) => {
      if (!alive) return;
      const linked = new Set([name, ...incoming.map((n) => n.id)]);
      setUnlinked(hits.filter((h) => !linked.has(h.name)).slice(0, 12));
    }).catch(() => {});
    return () => { alive = false; };
  }, [title, name, ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rbody">
      {parent && <Group title="상위" count={1}><Row n={parent} ctx={ctx} /></Group>}
      <Group title="하위" count={children.length}>{children.map((n) => <Row key={n.id} n={n} ctx={ctx} />)}</Group>
      <Group title="역링크" count={incoming.length}>{incoming.map((n) => <Row key={n.id} n={n} ctx={ctx} />)}</Group>
      <Group title="나가는 링크" count={outgoing.length}>{outgoing.map((n) => <Row key={n.id} n={n} ctx={ctx} />)}</Group>
      <Group title="링크 없는 언급" count={unlinked.length}>
        {unlinked.map((h) => <Row key={h.rel} n={{ id: h.name, title: h.title, type: h.type ?? '노트' }} ctx={ctx} sub={h.snippet} />)}
      </Group>
    </div>
  );
}

// 개요: 본문 제목을 누르면 그 자리로 (문서 보기에서)
function Outline({ body }) {
  const heads = [...(body ?? '').matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m, i) => ({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1'), i }));
  const go = (i) => {
    const hs = document.querySelectorAll('.doc-body .md h1, .doc-body .md h2, .doc-body .md h3, .doc-body .md h4, .doc-body .md h5, .doc-body .md h6, .doc-body .cm-heading-line');
    hs[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (!heads.length) return <div className="rbody"><div className="rempty">제목이 없는 문서</div></div>;
  const min = Math.min(...heads.map((h) => h.level));
  return (
    <div className="rbody">
      {heads.map((h) => (
        <button key={h.i} className="outline-row" style={{ paddingLeft: 8 + (h.level - min) * 14 }} onClick={() => go(h.i)}>{h.text}</button>
      ))}
    </div>
  );
}

// 태그: 이 문서의 태그 + 보관함 전체 태그 수
function Tags({ ctx, name }) {
  const nodes = ctx.graph?.nodes ?? [];
  const mine = nodes.find((n) => n.id === name)?.tags ?? [];
  const all = nodes.filter((n) => n.type === '태그').sort((a, b) => b.degree - a.degree);
  const toGraph = (t) => { try { sessionStorage.setItem('brain.graph.q', `tag:${t}`); } catch { /* 없어도 됨 */ } ctx.go({ view: 'graph' }); };
  return (
    <div className="rbody">
      <Group title="이 문서" count={mine.length} empty="태그 없음 — frontmatter tags: 또는 본문 #태그">
        <div className="tagcloud">{mine.map((t) => <button key={t} className="tagchip" onClick={() => toGraph(t)}>#{t}</button>)}</div>
      </Group>
      <Group title="보관함 전체" count={all.length} empty="아직 태그가 없음">
        <div className="tagcloud">{all.map((t) => <button key={t.id} className="tagchip" onClick={() => toGraph(t.title.slice(1))}>{t.title}<span>{t.degree}</span></button>)}</div>
      </Group>
    </div>
  );
}
