// 왼쪽 맨 끝 아이콘 줄 + 사이드바 "작업" 보기 (원본의 프로젝트 목록):
//   부서마다 열린 작업을 바로 늘어놓고 상태 배지(선택 필요·작업 중·New), 아래에 최근 작업 10개.
//   작업을 누르면 오른쪽 패널에 연다(Ctrl은 문서 탭).
import { Icon } from './icons.jsx';
import { Kind } from './TaskBits.jsx';
import { OPEN_STATUSES, shortTime } from './util.js';
import { actionItems } from './useSessions.js';

const pad = (n) => String(n).padStart(2, '0');
const NEW_MS = 60 * 60 * 1000;   // 만든 지 1시간 안이면 New
const toMs = (s) => (s ? new Date(String(s).replace('T', ' ').replace(/-/g, '/')).getTime() : 0);

// 맨 왼쪽 아이콘 줄: 보기 바로가기 + 결재함(배지 = 행동 필요 수, 누르면 데스크)
export function Rail({ ctx }) {
  const { route, go, state } = ctx;
  const view = route.view === 'doc' ? null : route.view;
  const mine = ctx.attention ? actionItems(ctx.attention).length : state.needsMe ?? 0;
  const item = (v, icon, label, key) => (
    <button className={`rail-btn ${view === v ? 'on' : ''}`} onClick={() => go({ view: v, dept: route.dept })} title={`${label} (Alt+${key})`} aria-label={label}>
      <Icon name={icon} size={17} />
    </button>
  );
  return (
    <nav className="rail" aria-label="보기">
      {item('desk', 'home', '데스크', 1)}
      <button className="rail-btn" onClick={() => go({ view: 'desk', dept: null })} title={`내 차례 ${mine} — 데스크에서 보기`} aria-label={`내 차례 ${mine}`}>
        <Icon name="check" size={17} />{mine > 0 && <b className="rail-badge">{mine}</b>}
      </button>
      <span className="rail-sep" />
      {item('map', 'map', '지도', 2)}
      {item('board', 'board', '보드', 3)}
      {item('timeline', 'clock', '기록', 4)}
      {item('graph', 'graph', '기억', 5)}
    </nav>
  );
}

function Badge({ t, pending }) {
  if (pending) return <span className="wbadge warn">선택 필요</span>;
  if (t.runtime?.phase === '실행') return <span className="wbadge acc"><i />작업 중</span>;
  if (t.runtime?.phase === '대기열') return <span className="wbadge num">대기열</span>;
  if (Date.now() - toMs(t.created) < NEW_MS) return <span className="wbadge new">New</span>;
  if (t.status === '검수') return <span className="wbadge ok">검수</span>;
  if (t.status === '대기예약') return <span className="wbadge num">예약</span>;
  return <span className="wtime">{shortTime(t.updated)}</span>;
}

function Row({ t, ctx, sub }) {
  const pending = ctx.pendingByTask[t.id];
  const live = t.runtime?.phase === '실행';
  return (
    <button className={`wrow ${ctx.route.panel === t.id ? 'on' : ''}`} onClick={(e) => ctx.pick(t.id, e)} onAuxClick={(e) => ctx.pick(t.id, e)} title={`${t.id} · ${t.title}`}>
      <Kind type="작업" color={ctx.deptColor[t.dept]} live={live} decide={!!pending} done={!OPEN_STATUSES.includes(t.status)} />
      <span className="wname">{t.title}</span>
      {sub ? <span className="wdept">{t.dept}</span> : <Badge t={t} pending={pending} />}
    </button>
  );
}

// 부서 하나의 요약 배지 (원본의 "작업 중 · 선택 필요 · New 1")
function deptBadge(list, ctx) {
  if (list.some((t) => ctx.pendingByTask[t.id])) return <span className="wbadge warn">선택 필요</span>;
  if (list.some((t) => t.runtime?.phase === '실행')) return <span className="wbadge acc"><i />작업 중</span>;
  const fresh = list.filter((t) => Date.now() - toMs(t.created) < NEW_MS).length;
  if (fresh) return <span className="wbadge new">New {fresh}</span>;
  return null;
}

export function WorkList({ ctx, needle }) {
  const { state, route, go } = ctx;
  const match = (t) => !needle || t.title.toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle);
  const rank = (t) => (ctx.pendingByTask[t.id] ? 0 : t.runtime?.phase === '실행' ? 1 : t.status === '검수' ? 2 : 3);
  const recent = [...state.tasks].filter(match).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 10);
  const view = route.view === 'doc' ? 'desk' : route.view;
  return (
    <div className="work">
      {state.depts.map((d) => {
        const list = state.tasks.filter((t) => t.dept === d.name && OPEN_STATUSES.includes(t.status) && match(t))
          .sort((a, b) => rank(a) - rank(b) || String(b.updated).localeCompare(String(a.updated)));
        if (needle && !list.length) return null;
        const on = route.view !== 'doc' && route.dept === d.name;
        return (
          <section key={d.name} className="wdept-sec">
            <button className={`wdept-head ${on ? 'on' : ''}`} onClick={() => go({ view, dept: on ? null : d.name })} title={on ? '부서 거르기 풀기' : `${d.name}만 보기`}>
              <span className="dot" style={{ '--c': d.color }} />
              <span className="tno">{pad(d.order ?? 0)}</span>
              <b>{d.name}</b>
              {deptBadge(list, ctx)}
              <span className="tcnt">{list.length || ''}</span>
            </button>
            {list.slice(0, 8).map((t) => <Row key={t.id} t={t} ctx={ctx} />)}
            {list.length > 8 && <button className="wmore" onClick={() => go({ view: 'board', dept: d.name })}>{list.length - 8}개 더 보기</button>}
          </section>
        );
      })}
      <div className="tree-head"><span>최근</span><span>{recent.length}</span></div>
      {recent.map((t) => <Row key={t.id} t={t} ctx={ctx} sub />)}
    </div>
  );
}
