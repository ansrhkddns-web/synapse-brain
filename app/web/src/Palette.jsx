// Ctrl+K 팔레트: 최근 문서·이동·문서 찾기·본문 검색. Ctrl+1~9는 n번째 항목을 바로 연다
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Kind } from './TaskBits.jsx';

// 참고 문서(시냅스)는 경로가 길어서 dir·md로만
const short = (n) => (n.type === '폴더' ? 'dir' : n.type === '참고' ? 'md' : n.id);

export function Palette({ ctx, onClose }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [sel, setSel] = useState(0);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return undefined; }
    const t = setTimeout(() => api.search(q).then(setHits).catch(() => setHits([])), 140);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const byId = new Map((ctx.graph?.nodes ?? []).map((n) => [n.id, n]));
    let recentIds = [];
    try { recentIds = JSON.parse(localStorage.getItem('brain.recent') ?? '[]'); } catch { /* 없음 */ }
    const recent = needle ? [] : recentIds.filter((id) => byId.has(id)).slice(0, 6)
      .map((id) => ({ group: '최근', label: byId.get(id).title, meta: short(byId.get(id)), key: id, run: () => ctx.open(id), node: byId.get(id) }));
    const nav = [
      { group: '이동', label: '데스크', meta: 'Alt 1', run: () => ctx.go({ view: 'desk' }), icon: 'home' },
      { group: '이동', label: '예전 개요', meta: '#/overview', run: () => ctx.go({ view: 'overview' }), icon: 'home' },
      { group: '이동', label: '프로세스 지도', meta: 'Alt 2', run: () => ctx.go({ view: 'map' }), icon: 'map' },
      { group: '이동', label: '기억 (문서·참고 지식 그래프·질문)', meta: 'Alt 5', run: () => ctx.go({ view: 'graph' }), icon: 'graph' },
      { group: '이동', label: '프로세스 보드', meta: 'Alt 3', run: () => ctx.go({ view: 'board' }), icon: 'board' },
      { group: '이동', label: '기록', meta: 'Alt 4', run: () => ctx.go({ view: 'timeline' }), icon: 'clock' },
      { group: '이동', label: '새 일 시키기', meta: '명령 막대', run: () => ctx.focusCommand(), icon: 'plus' },
      ...ctx.state.depts.map((d) => ({ group: '부서', label: d.name, meta: '부서', run: () => ctx.go({ view: 'desk', dept: d.name }), color: d.color })),
    ].filter((x) => !needle || x.label.toLowerCase().includes(needle));
    const docs = (ctx.graph?.nodes ?? [])
      .filter((n) => !['부서', '유령', '태그'].includes(n.type) && (!needle || n.title.toLowerCase().includes(needle) || n.id.toLowerCase().includes(needle)))
      .filter((n) => needle || !recentIds.includes(n.id))
      .slice(0, needle ? 12 : 6)
      .map((n) => ({ group: '문서', label: n.title, meta: short(n), key: n.id, run: () => ctx.open(n.id), node: n }));
    const seen = new Set([...docs, ...recent].map((d) => d.key ?? d.meta));
    const body = hits.filter((h) => !seen.has(h.name)).slice(0, 8)
      .map((h) => ({ group: '본문', label: h.title, meta: h.name, sub: h.snippet, run: () => ctx.open(h.name), node: { type: h.type } }));
    return [...recent, ...nav, ...docs, ...body];
  }, [q, hits, ctx]);

  useEffect(() => { setSel(0); }, [q]);

  const onKey = (e) => {
    const n = (e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
    if (n >= 0) { e.preventDefault(); if (items[n]) { items[n].run(); onClose(); } }
    else if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing && items[sel]) { items[sel].run(); onClose(); }
  };

  let lastGroup = null;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="명령 팔레트">
        <div className="pal-in"><Icon name="search" size={17} /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="문서, 작업, 결정, 부서로 이동…" /><kbd>Esc</kbd></div>
        <div className="pal-list">
          {items.length === 0 && <div className="empty-line" style={{ padding: 14 }}>— 찾은 게 없음</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="pal-group" key={`g${i}`}>{it.group}</div> : null;
            lastGroup = it.group;
            return [
              head,
              <button key={i} className={`pal-item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => { it.run(); onClose(); }}>
                {it.icon ? <Icon name={it.icon} size={14} /> : it.color ? <span className="dot" style={{ '--c': it.color }} /> : <Kind type={it.node?.type} color={ctx.deptColor[it.node?.dept]} />}
                <span className="tname">{it.label}{it.sub && <small>{it.sub}</small>}</span>
                <span className="mono">{it.meta}</span>
                {i < 9 && <kbd className="pal-n">^{i + 1}</kbd>}
              </button>,
            ];
          })}
        </div>
      </div>
    </div>
  );
}
