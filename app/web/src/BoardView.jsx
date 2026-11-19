import { useState } from 'react';
import { DeptTag, StatusTag } from './TaskBits.jsx';
import { shortTime, taskLine } from './util.js';
import { workingIds } from './useSessions.js';

const COLS = [
  { status: '결정대기', label: '내 결정', c: 'var(--warn)' },
  { status: '실행중', label: '실행 중', c: 'var(--accent)' },
  { status: '대기예약', label: '예약', c: 'var(--num)' },
  { status: '검수', label: '검수', c: 'var(--ok)' },
];

export function BoardView({ ctx, dept }) {
  const [done, setDone] = useState(false);
  const working = workingIds(ctx.sessions);
  const tasks = ctx.state.tasks.filter((t) => !dept || t.dept === dept).sort((a, b) => b.updated.localeCompare(a.updated));
  const cols = done ? [...COLS, { status: '완료', label: '완료', c: 'var(--faint)' }] : COLS;
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="eyebrow"><span className="ebox" />보드 · <b>{dept ?? '전체'}</b><span style={{ marginLeft: 'auto' }}><button className="linkbtn" onClick={() => setDone((v) => !v)}>{done ? '완료 열 숨기기' : '완료 열 보기'}</button></span></div>
      <h1 className="doc-title">프로세스 보드</h1>
      <div className="board" style={{ '--cols': cols.length }}>
        {cols.map((col) => {
          const cards = tasks.filter((t) => (col.status === '완료' ? ['완료', '취소'].includes(t.status) : t.status === col.status));
          return (
            <section key={col.status} className="col">
              <div className="col-head"><span className="bar" style={{ '--c': col.c }} />{col.label}<span className="num">{cards.length}</span></div>
              <div className="cards">
                {cards.length === 0 && <div className="empty-line" style={{ textAlign: 'center' }}>—</div>}
                {cards.map((t) => (
                  <button key={t.id} className={`card ${t.runtime.phase === '실행' || working.has(t.id) ? 'live' : ''} ${ctx.pendingByTask[t.id] ? 'decide' : ''}`} onClick={(e) => ctx.pick(t.id, e)} onAuxClick={(e) => ctx.pick(t.id, e)} aria-current={ctx.route.panel === t.id || undefined}>
                    <div className="card-top"><span>{t.id}</span><span className="grow" /><span>{shortTime(t.updated)}</span></div>
                    <div className="card-title">{t.title}</div>
                    {taskLine(t, ctx.live) && <div className="card-body">{taskLine(t, ctx.live)}</div>}
                    <div className="card-foot"><DeptTag name={t.dept} color={ctx.deptColor[t.dept]} /><StatusTag task={working.has(t.id) ? { ...t, live: true } : t} pending={ctx.pendingByTask[t.id]} /></div>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
