// 일정비서 카드 (비서실 / 일정비서 하위 문서) — 섹션마다 일정을 심플한 카드로.
//   같은 대상(사람·프로젝트, 두뇌 작업은 하위 항목)의 일정은 섹션 안에서 대상 카드 아래로 묶는다. 다른 섹션에도 있으면 대상 카드에 적는다.
//   자료: GET /api/today (lib/today.mjs — 본문 마크다운과 같은 모델). "글"을 누르면 본문 그대로
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Markdown } from './Markdown.jsx';

export const TODAY = { dept: '비서실', unit: '일정비서' };
export const isToday = (d) => d?.type === '하위' && d.dept === TODAY.dept && d.name === TODAY.unit;
const SRC = { Asana: 'asana', 슬랙: 'slack', 지시방: 'order', 두뇌: 'brain' };

function Card({ c, ctx }) {
  const done = c.box === 'x';
  return (
    <div className={`tcard ${done ? 'done' : ''} ${c.late ? 'late' : ''}`}>
      <span className={`tbox ${c.box == null ? 'dot' : done ? 'on' : ''}`} aria-label={c.box == null ? '진행 중' : done ? '끝남' : '할 일'}>{done && <Icon name="check" size={11} />}</span>
      <div className="tc-main">
        <div className="tc-title">
          {c.label && <b className="tc-label">{c.label}</b>}
          {c.time && <span className="mono tc-time">{c.time}</span>}
          <span>{c.title}</span>
        </div>
        <div className="tc-meta">
          <span className={`tc-src ${SRC[c.source] ?? ''}`}>{c.source}</span>
          {c.where && <span>{c.where}</span>}
          {c.due && <span className={c.late ? 'tc-late' : 'tc-due'}>마감 {c.dueLabel}{c.late ? ` · ${c.late}일 지남` : ''}</span>}
          {c.flag && <span className={c.flag === '시각 지남' ? 'tc-late' : ''}>{c.flag}</span>}
        </div>
        {c.note && <div className="tc-note">{c.note}</div>}
      </div>
      {c.url ? <a className="tc-open" href={c.url} target="_blank" rel="noreferrer" title={c.url}><Icon name="link" size={13} /></a>
        : c.task ? <button className="tc-open mono" onClick={(e) => ctx.pick(c.task, e)} title={`${c.task} 열기`}>{c.task}<Icon name="chev" size={11} /></button>
        : null}
    </div>
  );
}

function Group({ g, ctx }) {
  return (
    <div className="tgroup">
      <div className="tg-head">
        <span className="tg-name">{g.target}</span>
        <span className="mono tg-n">{g.items.length}</span>
        {g.also.length > 0 && <span className="tg-also">{g.also.join('·')}에도 있음</span>}
      </div>
      <div className="tg-items">{g.items.map((c, i) => <Card key={i} c={c} ctx={ctx} />)}</div>
    </div>
  );
}

export function TodayCards({ ctx, body = null }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState('card');
  useEffect(() => { let alive = true; api.today().then((d) => alive && (setV(d), setErr(null))).catch((e) => alive && setErr(e.message)); return () => { alive = false; }; }, [ctx.tick]);
  const seg = body != null && (
    <div className="seg today-seg">
      <button className={mode === 'card' ? 'on' : ''} onClick={() => setMode('card')}>카드</button>
      <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>글</button>
    </div>
  );
  if (mode === 'text' || (err && body != null)) return <>{seg}{err && <div className="empty-line">— 카드를 못 불러옴: {err}</div>}<Markdown text={body} onOpen={ctx.open} onPreview={ctx.preview} /></>;
  if (err) return <div className="empty-line">— {err}</div>;
  if (!v) return <div className="empty-line">불러오는 중…</div>;
  return (
    <div className="today">
      {seg}
      <div className="today-head">{v.title}</div>
      <p className="today-intro">{v.intro}</p>
      {v.summary && <blockquote className="today-sum">{v.summary}</blockquote>}
      {v.sections.map((s) => (
        <section key={s.key} className={`today-sec ${s.count ? '' : 'empty'}`}>
          <h3>{s.title}{s.count > 0 && <span className="mono">{s.count}</span>}</h3>
          {s.count
            ? <div className="today-list">{s.entries.map((e, i) => (e.items ? <Group key={i} g={e} ctx={ctx} /> : <Card key={i} c={e} ctx={ctx} />))}</div>
            : <div className="today-empty">{s.empty}</div>}
        </section>
      ))}
    </div>
  );
}

// ── 할 일 하나 (오른쪽 패널, id = todo:<할 일 id>) — 지도의 일정비서 카드를 누르면 열린다.
//   내용·출처·마감 · 완료로 지우기(끝낸 일이면 되살리기) · 원문 열기(Asana·슬랙) · 이 일에 대해 시키기
//   시키면 비서실 / 일정비서 작업이 생겨 이 할 일에 이어지고, 그다음부터 카드를 누르면 그 작업의 대화가 열린다
const ASK_CHIPS = ['답장 초안 써줘', '무슨 일인지 자세히 알아봐', '할 일을 단계로 쪼개줘'];

export function TodoPanel({ id, ctx }) {
  const todoId = id.slice(5);
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; api.today().then((d) => alive && setV(d)).catch((e) => alive && setErr(e.message)); return () => { alive = false; }; }, [ctx.tick]);
  const found = useMemo(() => {
    for (const s of v?.sections ?? []) for (const e of s.entries) for (const c of e.items ? e.items.map((x) => ({ ...x, target: e.target })) : [e]) if (c.id === todoId) return { s, c };
    return null;
  }, [v, todoId]);
  const head = (title, eyebrow = '일정비서 · 할 일') => (
    <div className="insp-head">
      <div className="insp-top"><span className="insp-eyebrow">{eyebrow}</span><span className="grow" /><button className="iconbtn" onClick={ctx.closePanel} title="패널 닫기 (Ctrl+.)"><Icon name="x" size={14} /></button></div>
      <div className="insp-title">{title}</div>
    </div>
  );
  if (err) return head(`불러오지 못함 — ${err}`);
  if (!v) return head('불러오는 중…');
  if (!found) return <>{head('오늘 목록에 없는 할 일')}<div className="insp-body"><p className="empty-line">이미 끝났거나 다음 모음에서 빠졌어요.</p></div></>;
  const { s, c } = found;
  const isDone = c.box === 'x';
  const act = async (fn) => { setBusy(true); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const done = () => act(async () => { setV(await api.todayDone(c.id, isDone)); ctx.refresh(); });
  const skip = () => act(async () => { setV(await api.todaySkip(c.id)); ctx.refresh(); });
  const ask = (t = text) => act(async () => {
    if (!t.trim()) return;
    // 이미 이어진 작업이 있으면 그 작업에 이어서, 없으면 새 작업으로
    const task = c.task ? (await api.send(c.task, t.trim()), c.task) : (await api.todayAsk(c.id, t.trim())).task;
    setText('');
    ctx.refresh();
    ctx.inspect(task);
  });
  return (
    <>
      {head(<>{c.target && c.source !== '두뇌' && <span className="todo-who">{c.target} · </span>}{c.title}</>, `일정비서 · ${s.short}`)}
      <div className="insp-body todo-panel">
        <dl className="todo-meta">
          <dt>출처</dt><dd><span className={`tc-src ${SRC[c.source] ?? ''}`}>{c.source}</span>{c.where && <> · {c.where}</>}</dd>
          {c.due && <><dt>마감</dt><dd className={c.late ? 'tc-late' : ''}>{c.dueLabel}{c.late ? ` · ${c.late}일 지남` : ''}</dd></>}
          {c.note && <><dt>메모</dt><dd>{c.note}</dd></>}
          {c.task && <><dt>작업</dt><dd><button className="linkbtn mono" onClick={(e) => ctx.pick(c.task, e)}>{c.task}</button>{c.taskStatus && <> · {c.taskStatus}</>}</dd></>}
        </dl>
        <div className="todo-actions">
          {(c.clearable || c.undo) && <button className={`btn ${isDone ? '' : 'primary'}`} disabled={busy} onClick={done}><Icon name="check" size={13} />{isDone ? (c.skipped ? '내 일로 되돌리기' : '되살리기') : '완료로 지우기'}</button>}
          {c.clearable && <button className="btn" disabled={busy} onClick={skip} title="내 업무가 아니면 목록에서 뺍니다 (30일 동안 다시 뜨지 않음)"><Icon name="x" size={13} />내 일 아님 · 스킵</button>}
          {c.url && <a className="btn" href={c.url} target="_blank" rel="noreferrer"><Icon name="link" size={13} />{c.source === '슬랙' ? '슬랙에서 열기' : c.source === 'Asana' ? 'Asana에서 열기' : '원문 열기'}</a>}
        </div>
        {!c.task && (
          <div className="todo-chips">
            {ASK_CHIPS.map((t) => <button key={t} className="chip" disabled={busy} onClick={() => ask(t)}>{t}</button>)}
          </div>
        )}
        {err && <div className="sc-reply err" role="status">{err}</div>}
      </div>
      <div className="sc-replybox">
        <div className="sc-target">↳ {c.task ? <>이어진 작업 <span className="mono">{c.task}</span></> : '비서실 / 일정비서 — 새 작업으로 시킵니다'}</div>
        <div className="insp-reply">
          <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); } }}
            placeholder="이 할 일에 대해 시키기… (예: 답장 초안 써줘)" aria-label="이 할 일에 대해 시키기" />
          <button className="sendbtn" onClick={() => ask()} disabled={!text.trim() || busy} title="보내기 (Enter)"><Icon name="up" size={15} /></button>
        </div>
      </div>
    </>
  );
}
