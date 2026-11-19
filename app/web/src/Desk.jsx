// 데스크 (첫 화면 #/, 부서로 거르면 #/dept/<부서>): 3초 안에 "내 차례"와 "돌아가는 중"
//   머리: 날짜·시각 + 숫자 4개(내 차례 · 새 답 · 돌아가는 중 · 오늘 끝남)
//   왼쪽 위 내 차례(행동 필요) · 왼쪽 아래 새 답(읽은 것은 접음) · 오른쪽 돌아가는 중 · 아래 오늘 흐름
//   가운데 영역 폭이 720px보다 좁으면 한 열로 쌓는다 (창 폭이 아니라 이 영역의 실제 폭)
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { DecisionCard } from './DocPage.jsx';
import { CopyButton, SessionCard, hm, sinceText } from './SessionCard.jsx';
import { KIND } from './TimelineView.jsx';
import { OPEN_STATUSES, isToday, plain } from './util.js';
import { actionItems, liveSessions, unseenAnswers, useSeen, ANSWER_KINDS } from './useSessions.js';

const WEEK = '일월화수목금토';
const pad = (n) => String(n).padStart(2, '0');
const KIND_TONE = { 결정: 'wait', 권한: 'wait', 입력대기: 'wait', 승인: 'wait', 실패: 'err', 멈춤의심: 'err', 검수: 'done', 새답: 'done' };
const KIND_LABEL = { 결정: '결정', 권한: '권한 요청', 입력대기: '입력 대기', 승인: '승인 기다림', 실패: '실패', 멈춤의심: '멈춤 의심', 검수: '답 왔음', 새답: '답 왔음' };

function useWidth(ref) {
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  return now;
}

export function Desk({ ctx, dept = null }) {
  const root = useRef(null);
  const narrow = useWidth(root) < 720;
  const now = useClock();
  const [seen] = useSeen();
  const [showSeen, setShowSeen] = useState(false);
  const { state } = ctx;
  const taskOf = (id) => (id ? state.tasks.find((t) => t.id === id) : null);
  const inDept = (taskId, s) => !dept || (s?.task?.dept ?? taskOf(taskId)?.dept) === dept;

  const loading = ctx.sessions == null || ctx.attention == null;
  const attention = (ctx.attention ?? []).filter((x) => inDept(x.task));
  const mine = actionItems(attention);
  const answersAll = attention.filter((x) => ANSWER_KINDS.has(x.kind));
  const fresh = unseenAnswers(answersAll, seen);
  const read = answersAll.filter((x) => !fresh.includes(x));
  const sessions = (ctx.sessions ?? []).filter((s) => inDept(s.id, s) && (!dept || s.task));
  const live = liveSessions(sessions);
  const sessionOf = (taskId) => (ctx.sessions ?? []).find((s) => s.id === taskId);

  const deptInfo = dept ? state.depts.find((d) => d.name === dept) : null;
  const units = dept ? (state.units ?? []).filter((u) => u.dept === dept) : [];

  return (
    <div className={`desk ${narrow ? 'one' : ''}`} ref={root}>
      <header className="desk-head">
        <div className="desk-when">
          <div className="desk-crumb">
            {dept ? <><button className="sc-link" onClick={() => ctx.go({ view: 'desk', dept: null })}>데스크</button><span> › </span><b>{dept}</b></> : '데스크'}
          </div>
          <h1 className="desk-date">{now.getMonth() + 1}월 {now.getDate()}일 ({WEEK[now.getDay()]}) <span className="mono">{pad(now.getHours())}:{pad(now.getMinutes())}</span></h1>
          {deptInfo?.summary && <p className="desk-sum">{deptInfo.summary}</p>}
        </div>
        <div className="desk-nums" aria-label="지금 상태">
          <Num label="내 차례" n={mine.length} tone={mine.length ? 'wait' : ''} />
          <Num label="새 답" n={fresh.length} tone={fresh.length ? 'done' : ''} />
          <Num label="돌아가는 중" n={live.length} tone={live.length ? 'work' : ''} />
          <Num label="오늘 끝남" n={state.doneToday ?? 0} />
        </div>
      </header>

      {dept && (
        <div className="desk-units">
          {units.map((u) => {
            const n = state.tasks.filter((t) => t.dept === dept && t.unit === u.name && OPEN_STATUSES.includes(t.status)).length;
            return <button key={u.name} className="sc-chip" onClick={() => ctx.open(`하위:${dept}/${u.name}`)} title={u.summary ?? ''}>{u.name}{n ? <span className="mono"> {n}</span> : null}</button>;
          })}
          <button className="sc-chip" onClick={async () => {
            const name = window.prompt(`${dept}에 추가할 하위 항목 이름`);
            if (!name?.trim()) return;
            try { const { id } = await api.createUnit({ dept, name: name.trim() }); ctx.refresh(); ctx.open(id); } catch (e) { window.alert(e.message); }
          }}><Icon name="plus" size={12} />하위 항목 추가</button>
        </div>
      )}

      <div className="desk-grid">
        <div className="desk-col left">
          <section className="desk-sec">
            <h2 className="desk-h">내 차례 <span className="mono">{mine.length}</span></h2>
            {loading ? <div className="desk-empty">불러오는 중…</div>
              : mine.length === 0 ? <div className="desk-empty">지금 내가 할 일이 없어요. 세션이 결정을 올리거나 답을 끝내면 여기에 뜹니다.</div>
                : <div className="desk-list">{mine.map((x) => <ActionCard key={x.key} x={x} ctx={ctx} task={taskOf(x.task)} />)}</div>}
          </section>
          <section className="desk-sec">
            <h2 className="desk-h">새 답 <span className="mono">{fresh.length}</span></h2>
            {!loading && fresh.length === 0 && <div className="desk-empty">새로 온 답이 없어요. 세션이 턴을 끝내면 여기에 올라옵니다.</div>}
            <div className="desk-list">
              {fresh.map((x) => <AnswerCard key={x.key} x={x} ctx={ctx} s={sessionOf(x.task)} unseen />)}
              {read.length > 0 && (
                <button className="desk-fold" onClick={() => setShowSeen((v) => !v)}>{showSeen ? '본 것 접기' : `본 것 ${read.length}개`}</button>
              )}
              {showSeen && read.map((x) => <AnswerCard key={x.key} x={x} ctx={ctx} s={sessionOf(x.task)} />)}
            </div>
          </section>
        </div>
        <div className="desk-col right">
          <section className="desk-sec">
            <h2 className="desk-h">돌아가는 중 <span className="mono">{live.length}</span></h2>
            {loading ? <div className="desk-empty">불러오는 중…</div>
              : live.length === 0 ? (
                <div className="desk-empty">도는 세션이 없어요.<br />아래에서 부서에 새 일을 시키거나, Claude 앱·터미널에서 세션을 열면 여기에 보입니다.</div>
              ) : <div className="desk-list">{live.map((s) => <SessionCard key={s.id} s={s} ctx={ctx} onOpen={(e) => ctx.pick(s.id, e)} />)}</div>}
          </section>
        </div>
      </div>

      <TodayFlow ctx={ctx} dept={dept} />
    </div>
  );
}

// 숫자가 바뀌면 굴러가듯 올라가고 한 번 빛난다
function useRoll(n) {
  const [v, setV] = useState(n);
  const cur = useRef(n);
  useEffect(() => {
    const from = cur.current; cur.current = n;
    if (from === n || matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(n); return undefined; }
    const t0 = performance.now(); let raf = 0;
    const step = (t) => { const p = Math.min(1, (t - t0) / 600); setV(Math.round(from + (n - from) * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  return v;
}
function Num({ label, n, tone }) {
  const v = useRoll(n);
  return (
    <div className={`desk-num ${tone ? `s-${tone}` : ''}`}>
      <b key={n} className="roll">{v.toLocaleString('ko-KR')}</b>
      <span>{label}</span>
    </div>
  );
}

// 내 차례 한 장: 결정·권한은 카드 안에서 답하고, 입력 대기는 앱으로 안내, 승인·실패는 공정 버튼, 멈춤 의심은 멈추기
function ActionCard({ x, ctx, task }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [note, setNote] = useState('');
  const act = async (fn, ok) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ text: ok }); ctx.refresh(); ctx.reloadSessions?.(); } catch (e) { setMsg({ text: e.message, err: true }); } finally { setBusy(false); }
  };
  const decision = x.decision ? ctx.state.pending.find((d) => d.id === x.decision) : null;
  const tone = KIND_TONE[x.kind] ?? 'wait';
  const where = task ? (task.unit ? `${task.dept} / ${task.unit}` : task.dept) : null;
  const folder = x.cwd ? x.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('\\') : null;
  const openTask = (e) => x.task && ctx.pick(x.task, e);
  return (
    <div className={`sc compact t-${tone} desk-act`}>
      <div className="sc-top">
        <i className="sc-dot" aria-hidden />
        <span className={`sc-kind s-${tone}`}>{KIND_LABEL[x.kind] ?? x.kind}</span>
        <div className="sc-title">
          {x.task ? <button className="sc-tlink" onClick={openTask} title={`${x.task} 열기`}>{task?.title ?? x.title}</button> : <span>{x.title}</span>}
        </div>
        <span className="sc-id mono">{x.task ?? ''}</span>
      </div>
      <div className="sc-sub">
        {where && <span>{where}</span>}
        {x.source && <span className="sc-src">{x.source}</span>}
        {x.also?.length > 0 && x.also.map((k, i) => <span key={i} className="sc-src">+ {KIND_LABEL[k] ?? k}</span>)}
        <span className="grow" />
        {x.at && <span className="sc-quiet">{sinceText(x.at)}</span>}
      </div>

      {(x.kind === '결정' || x.kind === '권한') && (decision ? <DecisionCard decision={decision} ctx={ctx} /> : <div className="sc-body">{x.body}</div>)}

      {x.kind === '입력대기' && (
        <>
          {x.body && <div className="sc-now warn"><span className="sc-k">기다림</span><span>{x.body}</span></div>}
          <div className="desk-wait">
            {folder && <span title={x.cwd}>폴더 <b>{folder}</b></span>}
            {x.session && <span>세션 <span className="mono">{x.session.slice(0, 8)}</span> <CopyButton text={x.session} label="id 복사" /></span>}
          </div>
          <div className="sc-note">Claude 앱에서 이 세션을 찾아 답하세요.</div>
        </>
      )}

      {(x.kind === '승인' || x.kind === '실패') && (
        <>
          <div className="sc-body">{x.body}</div>
          <div className="sc-again">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="덧붙일 말 (선택)" aria-label="덧붙일 말" disabled={busy} />
          </div>
          <div className="sc-chips">
            {x.kind === '승인' && <button className="sc-chip primary" disabled={busy} onClick={() => act(() => api.processApprove(x.process, note.trim()), '→ 승인 — 다음 단계로 넘겼어요')}>승인</button>}
            <button className="sc-chip" disabled={busy} onClick={() => act(() => api.processRetry(x.process, note.trim()), '→ 같은 단계를 다시 돌려요')}>다시 돌리기</button>
            {x.task && <button className="sc-chip" onClick={(e) => ctx.pick(x.task, e)}>결과 보기</button>}
            <button className="sc-chip" onClick={(e) => ctx.pick(x.process, e)}>공정 열기</button>
          </div>
        </>
      )}

      {x.kind === '멈춤의심' && (
        <>
          <div className="sc-body">{x.body}</div>
          <div className="sc-chips">
            <button className="sc-chip stop" disabled={busy} onClick={() => act(() => api.stop(x.task), '→ 멈추기 신호를 보냈어요')}>멈추기</button>
            <button className="sc-chip" onClick={openTask}>열기</button>
          </div>
        </>
      )}
      {msg && <div className={`sc-reply ${msg.err ? 'err' : ''}`}>{msg.text}</div>}
    </div>
  );
}

// 새 답 한 장: 세션 카드(확인 완료 · 다시… 칩)를 그대로 쓰고, 세션 목록에 없으면 간단한 카드
function AnswerCard({ x, ctx, s, unseen = false }) {
  if (s) return <SessionCard s={s} ctx={ctx} answer={x.answer} unseen={unseen} onOpen={(e) => ctx.pick(x.task, e)} />;
  return (
    <div className="sc compact t-done clickable" role="button" tabIndex={0} onClick={(e) => ctx.pick(x.task, e)}>
      <div className="sc-top"><i className="sc-dot" aria-hidden /><div className="sc-title"><span>{x.title}</span></div>{unseen && <span className="sc-new">새 답</span>}<span className="sc-id mono">{x.task}</span></div>
      <div className="sc-sub"><span className="sc-state s-done">답 왔음</span><span>{x.body}</span><span className="grow" />{x.at && <span className="sc-quiet">{sinceText(x.at)}</span>}</div>
    </div>
  );
}

// 오늘 흐름: 기록(타임라인)에서 오늘 것 30개
function TodayFlow({ ctx, dept }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let alive = true;
    api.timeline(dept, null, 30).then((e) => alive && setEvents(e.filter((x) => isToday(x.at)))).catch(() => alive && setEvents([]));
    return () => { alive = false; };
  }, [dept, ctx.tick]);
  const seenKeys = useRef(null);
  const keyOf = (e) => `${e.at}:${e.seq}:${e.task ?? ''}`;
  // 처음 그린 뒤에 새로 들어온 줄만 반짝인다
  const fresh = new Set();
  if (events) {
    if (seenKeys.current) for (const e of events) if (!seenKeys.current.has(keyOf(e))) fresh.add(keyOf(e));
  }
  useEffect(() => { if (events) seenKeys.current = new Set(events.map(keyOf)); }, [events]);
  return (
    <section className="desk-sec desk-flow">
      <h2 className="desk-h">오늘 흐름 <span className="mono">{events?.length ?? ''}</span><span className="grow" /><button className="sc-link" onClick={() => ctx.go({ view: 'timeline', dept })}>기록 전체 →</button></h2>
      {events == null ? <div className="desk-empty">불러오는 중…</div>
        : events.length === 0 ? <div className="desk-empty">오늘 아직 기록이 없어요.</div>
          : (
            <ol className="desk-flowlist">
              {events.map((e) => {
                const k = KIND[e.kind] ?? KIND.log;
                return (
                  <li key={keyOf(e)} className={fresh.has(keyOf(e)) ? 'flash' : ''}>
                    <span className="mono">{String(e.at).slice(11, 16) || hm(e.at)}</span>
                    <span className="desk-fk" style={{ '--c': k.c }}>{k.label}</span>
                    {e.task ? <button className="sc-link mono" onClick={(ev) => ctx.pick(e.task, ev)}>{e.task}</button> : <span />}
                    <span className="desk-ft">{plain(e.text, 180)}</span>
                  </li>
                );
              })}
            </ol>
          )}
    </section>
  );
}
