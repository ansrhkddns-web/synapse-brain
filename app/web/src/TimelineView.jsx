import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { DeptTag } from './TaskBits.jsx';
import { plain } from './util.js';

// 사건 종류 → 글자·색 (점 하나 + 짧은 이름, 보드·상태와 같은 규칙)
export const KIND = {
  create: { label: '생성', c: 'var(--text-2)' },
  log: { label: '진행', c: 'var(--faint)' },
  user: { label: '지시', c: 'var(--text)' },
  decision: { label: '결정 요청', c: 'var(--warn)' },
  answer: { label: '답함', c: 'var(--warn)' },
  result: { label: '결과', c: 'var(--ok)' },
  error: { label: '오류', c: 'var(--danger)' },
  schedule: { label: '예약', c: 'var(--num)' },
  delegate: { label: '위임', c: 'var(--accent)' },
  state: { label: '상태', c: 'var(--text-2)' },
};
const IMPORTANT = new Set(['decision', 'answer', 'error', 'result']);
const MODES = [['compact', '압축'], ['bars', '시간 막대'], ['full', '전체']];

const dayOf = (at) => at.slice(0, 10);
const hm = (at) => at.slice(11, 16);
const ms = (at) => new Date(at.replace(/-/g, '/').replace('T', ' ')).getTime();
const dayLabel = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  const w = '일월화수목금토'[new Date(y, m - 1, day).getDay()];
  return `${m}월 ${day}일 (${w})`;
};

export function TimelineView({ ctx, dept }) {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('brain.timeline.mode') ?? 'compact'; } catch { return 'compact'; } });
  const [onlyKey, setOnlyKey] = useState(false);
  const [paused, setPaused] = useState(false);
  const [events, setEvents] = useState(null);
  const held = useRef(null);
  useEffect(() => { try { localStorage.setItem('brain.timeline.mode', mode); } catch { /* 저장 못 해도 됨 */ } }, [mode]);

  // 서버 이벤트(ctx.tick)마다 다시 읽는다. 멈춤이면 화면은 그대로 두고 새 개수만 센다
  useEffect(() => {
    let alive = true;
    api.timeline(dept).then((e) => {
      if (!alive) return;
      if (paused && events) held.current = e; else { setEvents(e); held.current = null; }
    }).catch(() => {});
    return () => { alive = false; };
  }, [dept, ctx.tick, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const resume = () => { if (held.current) setEvents(held.current); held.current = null; setPaused(false); };
  const shown = useMemo(() => (events ?? []).filter((e) => !onlyKey || IMPORTANT.has(e.kind)), [events, onlyKey]);
  const fresh = held.current ? Math.max(0, held.current.length - (events?.length ?? 0)) : 0;

  return (
    <div className="page tl-page">
      <div className="eyebrow"><span className="ebox" />기록 · <b>{dept ?? '전체'}</b><span style={{ marginLeft: 'auto' }} className="mono">사건 {shown.length}개</span></div>
      <h1 className="doc-title">기록</h1>
      <div className="tl-bar">
        <div className="seg" role="tablist" aria-label="보기 방식">
          {MODES.map(([k, l]) => <button key={k} role="tab" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}
        </div>
        <label className="chk"><input type="checkbox" checked={onlyKey} onChange={(e) => setOnlyKey(e.target.checked)} />결정·결과·오류만</label>
        <span className="grow" />
        {paused
          ? <button className="btn" onClick={resume}><Icon name="play" />이어 보기{fresh > 0 && <span className="num"> +{fresh}</span>}</button>
          : <button className="btn ghost" onClick={() => setPaused(true)} title="새 사건이 와도 화면을 그대로 둔다"><Icon name="pause" />실시간 멈춤</button>}
      </div>

      {events == null ? <div className="empty-line">— 불러오는 중</div>
        : shown.length === 0 ? (
          <div className="emptybox">
            <Icon name="clock" size={18} />
            <div><b>기록된 사건이 없어요</b><p>작업 문서의 진행 로그가 여기에 시간순으로 쌓여요.</p></div>
          </div>
        ) : mode === 'bars' ? <Bars events={shown} ctx={ctx} />
          : <Days events={shown} ctx={ctx} compact={mode === 'compact'} />}
    </div>
  );
}

// 날짜별로 묶는다. 압축 보기는 그날 같은 작업의 사건을 한 줄로 접는다 (×N, 최신 사건 자리에)
function Days({ events, ctx, compact }) {
  const days = [];
  for (const e of events) {
    const d = dayOf(e.at);
    let day = days.at(-1);
    if (day?.d !== d) days.push(day = { d, rows: [] });
    const same = compact && day.rows.find((r) => r.e.task === e.task);
    if (same) same.more.push(e);
    else day.rows.push({ e, more: [] });
  }
  return days.map(({ d, rows }) => (
    <section key={d} className="tl-day">
      <div className="tl-date">{dayLabel(d)}</div>
      <ol className="tl">
        {rows.map((r) => <Row key={`${r.e.task}:${r.e.at}:${r.e.seq}`} row={r} ctx={ctx} compact={compact} />)}
      </ol>
    </section>
  ));
}

function Row({ row, ctx, compact }) {
  const [open, setOpen] = useState(false);
  const { e, more } = row;
  // 압축 줄의 대표는 묶음에서 가장 중요한 사건
  const head = compact ? [e, ...more].find((x) => IMPORTANT.has(x.kind)) ?? e : e;
  const k = KIND[head.kind] ?? KIND.log;
  return (
    <li className={`tl-row k-${head.kind}`}>
      <span className="tl-time num">{more.length > 0 && <>{hm(more.at(-1).at)}–</>}{hm(e.at)}</span>
      <span className="tl-dot" style={{ '--c': k.c }} />
      <div className="tl-main">
        <div className="tl-line">
          <span className="tl-kind" style={{ '--c': k.c }}>{k.label}</span>
          <button className="tl-task" onClick={(ev) => ctx.pick(e.task, ev)}
            onMouseEnter={(ev) => (ev.ctrlKey || ev.metaKey) && ctx.preview(e.task, ev.clientX, ev.clientY)}>
            <span className="mono">{e.task}</span>{e.title}
          </button>
          {more.length > 0 && <button className="tl-more" onClick={() => setOpen((v) => !v)}>×{more.length + 1}</button>}
          <span className="grow" />
          <DeptTag name={e.unit ? `${e.dept} / ${e.unit}` : e.dept} color={ctx.deptColor[e.dept]} />
        </div>
        <div className="tl-text">{plain(head.text, 220)}</div>
        {open && (
          <ol className="tl-sub">
            {[e, ...more].map((x) => (
              <li key={`${x.at}:${x.seq}`}><span className="num">{hm(x.at)}</span><span className="tl-kind" style={{ '--c': (KIND[x.kind] ?? KIND.log).c }}>{(KIND[x.kind] ?? KIND.log).label}</span>{plain(x.text, 220)}</li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

// 시간 막대: 작업마다 첫 사건~마지막 사건을 한 줄 막대로, 사건은 막대 위의 눈금
function Bars({ events, ctx }) {
  const tasks = useMemo(() => {
    const by = new Map();
    for (const e of events) {
      const t = by.get(e.task) ?? { id: e.task, title: e.title, dept: e.dept, status: e.status, ev: [] };
      t.ev.push({ ...e, t: ms(e.at) });
      by.set(e.task, t);
    }
    const list = [...by.values()].map((t) => ({ ...t, from: Math.min(...t.ev.map((x) => x.t)), to: Math.max(...t.ev.map((x) => x.t)) }));
    return list.sort((a, b) => b.to - a.to).slice(0, 60);
  }, [events]);
  const live = new Set(ctx.state.tasks.filter((t) => t.runtime.phase === '실행').map((t) => t.id));
  const lo = Math.min(...tasks.map((t) => t.from));
  const hi = Math.max(Date.now(), ...tasks.map((t) => t.to));
  const span = Math.max(60000, hi - lo);
  const x = (t) => `${((t - lo) / span) * 100}%`;
  // 눈금: 범위에 맞춰 1시간·6시간·하루
  const step = span > 4 * 86400000 ? 86400000 : span > 18 * 3600000 ? 6 * 3600000 : 3600000;
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const every = Math.ceil(ticks.length / 8);   // 글자는 8개 안팎만
  const tickLabel = (t) => { const d = new Date(t); return step >= 86400000 ? `${d.getMonth() + 1}/${d.getDate()}` : `${String(d.getHours()).padStart(2, '0')}:00`; };

  return (
    <div className="tlb">
      <div className="tlb-axis"><span />
        <div className="tlb-track">{ticks.map((t, i) => i % every === 0 && <span key={t} className="tlb-tick" style={{ left: x(t) }}>{tickLabel(t)}</span>)}</div>
      </div>
      {tasks.map((t) => {
        const c = ctx.deptColor[t.dept];
        return (
          <div key={t.id} className="tlb-row">
            <button className="tlb-name" onClick={(e) => ctx.pick(t.id, e)} title={t.title}>
              <span className="dot" style={{ '--c': c }} /><span className="mono">{t.id}</span><span className="tlb-title">{t.title}</span>
            </button>
            <div className="tlb-track">
              {ticks.map((k) => <span key={k} className="tlb-grid" style={{ left: x(k) }} />)}
              <span className={`tlb-span ${live.has(t.id) ? 'live' : ''}`} style={{ left: x(t.from), width: `calc(${x(live.has(t.id) ? Date.now() : t.to)} - ${x(t.from)} + 2px)`, '--c': c }} />
              {t.ev.map((e) => (
                <span key={`${e.at}:${e.seq}`} className={`tlb-ev k-${e.kind}`} style={{ left: x(e.t), '--c': (KIND[e.kind] ?? KIND.log).c }}
                  title={`${hm(e.at)} · ${(KIND[e.kind] ?? KIND.log).label} · ${plain(e.text, 120)}`} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
