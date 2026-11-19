// 상단 바: 경로(데스크 / 보기 / 부서 / 연 것) · 숫자 둘(내 차례 · 돌아가는 중) · 목표 지표(KPI) 줄 · 검색 · 보기 전환.
// 부서 고르기는 왼쪽 사이드바(작업 보기의 부서 머리)와 지도·그래프의 부서 고르기로 옮겼다.
import { Icon } from './icons.jsx';
import { actionItems, liveSessions } from './useSessions.js';

const VIEW = { desk: '데스크', overview: '개요', map: '지도', board: '보드', timeline: '기록', graph: '기억', calendar: '세무달력' };

export function TopBar({ ctx, onSearch }) {
  const { state, route, go } = ctx;
  const dept = route.dept ?? null;
  const view = route.view === 'doc' ? 'desk' : route.view;
  // 내 차례 = 행동 필요(결정·권한·입력대기·승인·실패·멈춤의심) — 데스크와 같은 목록을 센다
  const mine = ctx.attention ? actionItems(ctx.attention).length : state.needsMe ?? 0;
  const live = liveSessions(ctx.sessions).length;

  // 경로 끝: 문서 페이지면 그 문서, 패널에 연 작업이 있으면 그 작업
  const node = (id) => ctx.graph?.nodes.find((n) => n.id === id);
  const item = route.view === 'doc' ? { id: route.name, title: node(route.name)?.title ?? route.name }
    : route.panel === 'usage' ? { id: 'usage', title: 'PC 사용량' }
    : route.panel === 'activity' ? { id: 'activity', title: 'PC 작업' }
    : route.panel?.startsWith('cc:') ? { id: route.panel, title: `바깥 세션 ${route.panel.slice(3, 11)}` }
    : route.panel?.startsWith('todo:') ? { id: route.panel, title: '일정비서 · 할 일' }
    : route.panel && route.panel !== 'inbox' ? { id: route.panel, title: state.tasks.find((t) => t.id === route.panel)?.title ?? node(route.panel)?.title ?? route.panel, panel: true } : null;

  return (
    <header className="topbar">
      <button className="brand" onClick={() => go({ view: 'desk', dept: null })} aria-label="데스크로">
        <span className="brand-name">SYNAPSE BRAIN</span>
      </button>

      <nav className="crumbs" aria-label="경로">
        <button onClick={() => go({ view: 'desk', dept: null })}>데스크</button>
        {route.view !== 'doc' && view !== 'desk' && <><i>/</i><button onClick={() => go({ view, dept: null })}>{VIEW[view]}</button></>}
        {dept && <><i>/</i><button onClick={() => go({ view, dept })}>{dept}</button></>}
        {item && <><i>/</i><button className="crumb-item" onClick={() => (item.panel ? ctx.open(item.id) : null)} title={item.title}>{item.title}</button></>}
      </nav>

      <button className={`pill ${mine ? 'warn' : 'quiet'}`} onClick={() => go({ view: 'desk', dept: null })} title="데스크에서 내 차례 보기">
        <span className="dot" style={{ '--c': mine ? 'var(--s-wait, var(--warn))' : 'var(--faint)' }} />내 차례 <b>{mine}</b>
      </button>
      <button className={`pill ${live ? '' : 'quiet'}`} onClick={() => go({ view: 'desk', dept: null })} title="데스크에서 돌아가는 세션 보기">
        <span className="dot" style={{ '--c': live ? 'var(--s-work, var(--accent))' : 'var(--faint)' }} />돌아가는 중 <b>{live}</b>
      </button>

      <Kpi ctx={ctx} />

      <div className="top-right">
        <button className="searchbtn compact" onClick={onSearch} title="문서·작업·결정 검색 (Ctrl+K)">
          <Icon name="search" /><kbd>Ctrl K</kbd>
        </button>
        <div className="seg" role="tablist" aria-label="보기">
          {[['desk', 'home', 1], ['map', 'map', 2], ['board', 'board', 3], ['timeline', 'clock', 4], ['graph', 'graph', 5]].map(([v, icon, k]) => (
            <button key={v} role="tab" className={view === v && route.view !== 'doc' ? 'on' : ''} onClick={() => go({ view: v, dept })} title={`${VIEW[v]} (Alt+${k})`}>
              <Icon name={icon} /><span className="lbl">{VIEW[v]}</span>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

// 목표 지표: vault/지표/KPI.md 의 metrics — "이름 현재/목표" + 얇은 진행 막대. 비어 있으면 정하러 가는 링크
function Kpi({ ctx }) {
  const metrics = ctx.state.kpi ?? [];
  if (!metrics.length) {
    return <button className="kpi empty" onClick={(e) => ctx.pick('KPI', e)} title="vault/지표/KPI.md 에 목표를 적으면 여기에 떠요">목표 지표 정하기</button>;
  }
  const num = (v) => (typeof v === 'number' ? v.toLocaleString() : v);
  return (
    <div className="kpi" onClick={(e) => ctx.pick('KPI', e)} role="button" tabIndex={0} title="목표 지표 (눌러서 보기)">
      {metrics.map((m) => {
        const p = typeof m.current === 'number' && typeof m.target === 'number' && m.target ? Math.min(1, m.current / m.target) : null;
        return (
          <span key={m.name} className="kpi-item">
            {p != null && <i style={{ '--p': `${p * 100}%` }} />}
            {m.name} <b>{num(m.current)}</b>/{num(m.target)}{m.unit ?? ''}
          </span>
        );
      })}
    </div>
  );
}
