// 왼쪽 위키 트리: 서버 그래프의 트리 부모를 그대로 따른다 (나 → 부서 → 작업 → 결정·보고서)
import { useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Kind } from './TaskBits.jsx';
import { OPEN_STATUSES } from './util.js';
import { Rail, WorkList } from './SideWork.jsx';

const pad = (n) => String(n).padStart(2, '0');

export function Sidebar({ ctx, onToggle }) {
  const { state, graph, route, go, open } = ctx;
  const [q, setQ] = useState('');
  // 작업(부서별 열린 작업·최근) | 위키(문서 트리)
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('brain.side') || 'work'; } catch { return 'work'; } });
  const pickMode = (m) => { setMode(m); try { localStorage.setItem('brain.side', m); } catch { /* 없어도 됨 */ } };
  const [fold, setFold] = useState(() => new Map());   // 사용자가 직접 펼치거나 접은 줄 (id → 펼침?)
  const treeRef = useRef(null);
  const nodes = graph?.nodes ?? [];

  const { kids, byId } = useMemo(() => {
    const kids = new Map();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)).push(n);
    // 하위 항목(번호 순) → 작업·결정·보고서(최근 순) → 참고 폴더 → 참고 문서(이름 순)
    const rank = (n) => (n.type === '하위' ? 0 : n.type === '폴더' ? 2 : n.type === '참고' ? 3 : 1);
    for (const list of kids.values()) {
      list.sort((a, b) => rank(a) - rank(b)
        || (rank(a) === 0 ? (a.order ?? 0) - (b.order ?? 0)
          : rank(a) === 1 ? String(b.time ?? '').localeCompare(String(a.time ?? ''))
            : a.title.localeCompare(b.title, 'ko', { numeric: true })));
    }
    return { kids, byId };
  }, [nodes]);

  const tasks = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
  const pendingIds = new Set(Object.keys(ctx.pendingByTask));
  const current = route.view === 'doc' ? route.name : null;
  const needle = q.trim().toLowerCase();
  const match = (n) => !needle || n.title.toLowerCase().includes(needle) || n.id.toLowerCase().includes(needle);
  const subtreeMatch = (n) => match(n) || (kids.get(n.id) ?? []).some(subtreeMatch);
  const setOpen = (id, v) => setFold((m) => new Map(m).set(id, v));
  // 사용자가 정한 게 있으면 그대로, 없으면 기본값 (지금 연 문서까지 가는 길은 펼침)
  const openOf = (id, dflt) => (needle ? true : fold.get(id) ?? dflt);
  // 지금 연 문서까지 가는 길
  const path = new Set();
  for (let n = current && byId.get(current); n; n = byId.get(n.parent)) path.add(n.id);

  // 끝난 작업(완료·취소)은 접어 두고 "끝난 일 N개" 한 줄로. 찾는 중이거나, 지금 연 문서로 가는 길이거나, 펼친 곳은 보인다
  const [showDone, setShowDone] = useState(() => new Set());
  const toggleDone = (id) => setShowDone((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const isClosed = (n) => n.type === '작업' && !OPEN_STATUSES.includes(n.status);
  const split = (id, list) => {
    const closed = list.filter(isClosed).length;
    if (needle || showDone.has(id)) return { shown: list, closed };
    return { shown: list.filter((n) => !isClosed(n) || path.has(n.id)), closed };
  };
  const doneRow = (id, closed, depth) => (closed && !needle ? (
    <button key={`done:${id}`} className="trow tdone" style={{ '--depth': depth }} onClick={() => toggleDone(id)}>
      <span style={{ width: 12 }} /><span className="tname">{showDone.has(id) ? `끝난 일 접기` : `끝난 일 ${closed}개`}</span>
    </button>
  ) : null);

  const row = (n, depth) => {
    if (!subtreeMatch(n)) return null;
    const { shown: ch, closed } = split(n.id, kids.get(n.id) ?? []);
    const isOpen = openOf(n.id, path.has(n.id) && n.id !== current);
    const t = tasks[n.id];
    const live = t?.runtime?.phase === '실행';
    const decide = pendingIds.has(n.id) || (n.type === '결정' && n.status === '대기');
    const done = (n.type === '작업' && !OPEN_STATUSES.includes(n.status)) || (n.type === '결정' && n.status === '결정됨');
    return (
      <div key={n.id}>
        <button className={`trow ${current === n.id ? 'on' : ''}`} style={{ '--depth': depth }} onClick={(e) => (n.type === '작업' ? ctx.pick(n.id, e) : open(n.id))} title={n.title}
          data-id={n.id} data-parent={n.parent} data-open={ch.length || closed ? String(isOpen) : undefined}>
          {ch.length || closed ? (
            <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); setOpen(n.id, !isOpen); }}>
              <Icon name="chev" className={`chev ${isOpen ? 'open' : ''}`} size={12} />
            </span>
          ) : <span style={{ width: 12 }} />}
          <Kind type={n.type} color={ctx.deptColor[n.dept]} live={live} decide={decide} done={done} />
          <span className="tname" style={{ color: done ? 'var(--faint)' : undefined }}>{n.title}</span>
          {ch.length > 0 && <span className="tcnt">{ch.length}</span>}
        </button>
        {isOpen && ch.map((c) => row(c, depth + 1))}
        {isOpen && doneRow(n.id, closed, depth + 1)}
      </div>
    );
  };

  // 맨 위는 비서실장. 부서와 공통 기록은 비서실장 아래에 있다
  const chief = byId.get('비서실장');
  const roots = [...(kids.get('me') ?? []), ...(kids.get('비서실장') ?? [])].filter((n) => n.type !== '총괄');
  const depts = roots.filter((n) => n.type === '부서').sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  const [adding, setAdding] = useState(null); // 하위 항목을 추가하는 부서
  const others = roots.filter((n) => n.type !== '부서');
  const total = nodes.length;

  return (
    <aside className="side">
      <Rail ctx={ctx} />
      <div className="side-col">
        <div className="side-top">
          <label className="treefind">
            <Icon name="filter" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'work' ? '작업 찾기' : '트리에서 찾기'} aria-label="사이드바에서 찾기" />
          </label>
          <button className="iconbtn" onClick={onToggle} title="사이드바 접기 (Ctrl+\)"><Icon name="panel" /></button>
        </div>
        <div className="seg side-tabs" role="tablist" aria-label="사이드바 보기">
          <button role="tab" className={mode === 'work' ? 'on' : ''} onClick={() => pickMode('work')}>작업</button>
          <button role="tab" className={mode === 'wiki' ? 'on' : ''} onClick={() => pickMode('wiki')}>위키</button>
        </div>
        {mode === 'work' ? <div className="tree"><WorkList ctx={ctx} needle={needle} /></div> : (
        <div className="tree" ref={treeRef} onKeyDown={(e) => treeKeys(e, treeRef.current, setOpen)}>
          <button className={`trow ${route.view === 'desk' && !route.dept ? 'on' : ''}`} onClick={() => go({ view: 'desk' })}>
            <Icon name="target" size={13} /><span className="tname">데스크</span><span className="tcnt">{total}</span>
          </button>
          {chief && (
            <button className={`trow chief ${current === chief.id ? 'on' : ''}`} onClick={() => open(chief.id)} data-id={chief.id} title="모든 부서를 거느리는 가운데 점">
              <Kind type="총괄" /><span className="tname">관제실</span><span className="tcnt">{depts.length}</span>
            </button>
          )}
  
          <div className="tree-head"><span>부서</span><span>{depts.length}</span></div>
          {depts.map((d, i) => {
            const { shown: ch, closed } = split(d.id, (kids.get(d.id) ?? []).filter(subtreeMatch));
            if (needle && !ch.length && !match(d)) return null;
            const isOpen = openOf(d.id, path.has(d.id) || (route.view !== 'doc' && route.dept === d.title));
            const all = state.tasks.filter((t) => t.dept === d.title);
            const doneCount = all.filter((t) => !OPEN_STATUSES.includes(t.status) || t.status === '검수').length;
            const color = ctx.deptColor[d.title];
            const on = route.view !== 'doc' && route.dept === d.title;
            return (
              <div key={d.id}>
                <button className={`trow dept ${on ? 'on' : ''}`} onClick={() => go({ view: route.view === 'doc' ? 'desk' : route.view, dept: d.title })}
                  data-id={d.id} data-open={ch.length || closed ? String(isOpen) : undefined}>
                  <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); setOpen(d.id, !isOpen); }}>
                    <Icon name="chev" className={`chev ${isOpen ? 'open' : ''}`} size={12} />
                  </span>
                  <span className="tno">{pad(d.order ?? i + 1)}</span>
                  <span className="tname">{d.title}</span>
                  <span role="button" tabIndex={-1} className="tadd" title="하위 항목 추가" onClick={(e) => { e.stopPropagation(); setAdding(d.title); setOpen(d.id, true); }}><Icon name="plus" size={11} /></span>
                  <span className="tcnt" title="열린 작업 수">{all.filter((t) => OPEN_STATUSES.includes(t.status)).length || ''}</span>
                  <span className="tbar" style={{ '--c': color, '--p': `${all.length ? (doneCount / all.length) * 100 : 0}%` }}><i /></span>
                </button>
                {adding === d.title && <UnitAdder dept={d.title} onDone={(id) => { setAdding(null); if (id) { ctx.refresh(); open(id); } }} />}
                {isOpen && ch.map((c) => row(c, 1))}
                {isOpen && doneRow(d.id, closed, 1)}
              </div>
            );
          })}
  
          <div className="tree-head"><span>기록</span><span>{others.length}</span></div>
          {others.map((n) => row(n, 0))}
        </div>
        )}
      </div>
    </aside>
  );
}

// 트리 키보드: ↑↓ 줄 이동, ← 접기·부모로, → 펼치기·첫 자식으로, Enter 열기 (버튼 기본 동작)
function treeKeys(e, tree, setOpen) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || !e.target.classList?.contains('trow')) return;
  e.preventDefault();
  const rows = [...tree.querySelectorAll('.trow')];
  const i = rows.indexOf(e.target);
  const row = e.target;
  const focus = (r) => r?.focus({ preventScroll: false });
  if (e.key === 'ArrowDown') focus(rows[i + 1]);
  else if (e.key === 'ArrowUp') focus(rows[i - 1]);
  else if (e.key === 'Home') focus(rows[0]);
  else if (e.key === 'End') focus(rows.at(-1));
  else if (e.key === 'ArrowRight') {
    if (row.dataset.open === 'false') setOpen(row.dataset.id, true);
    else if (row.dataset.open === 'true') focus(rows[i + 1]);
  } else if (e.key === 'ArrowLeft') {
    if (row.dataset.open === 'true') setOpen(row.dataset.id, false);
    else focus(rows.find((r) => r.dataset.id && r.dataset.id === row.dataset.parent));
  }
}

// 부서 안에 하위 항목 추가: 이름 → Enter
function UnitAdder({ dept, onDone }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const submit = async () => {
    if (!name.trim()) { onDone(null); return; }
    try { const { id } = await api.createUnit({ dept, name: name.trim() }); onDone(id); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="tadder" style={{ '--depth': 1 }}>
      <input
        autoFocus
        value={name}
        onChange={(e) => { setName(e.target.value); setErr(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); if (e.key === 'Escape') onDone(null); }}
        onBlur={() => !name.trim() && onDone(null)}
        placeholder={`${dept} 하위 항목 이름`}
      />
      {err && <div className="tadder-err">{err}</div>}
    </div>
  );
}
