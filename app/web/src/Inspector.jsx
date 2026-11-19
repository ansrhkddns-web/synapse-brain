// 오른쪽 패널: 가운데 보기(데스크·보드·그래프·기록)와 늘 같이 뜨는 작업대.
//   작업 → 머리 세션 카드 · 대화(실행 N번째로 묶음·도구 칩 한국어) | 결과(증거·판정) | 기록(진행 로그) | 문서 · 아래 입력창
//   cc:<세션 id> → 작업 기록 전 바깥 세션 (대화만, 읽기 전용)
//   inbox → 결재함(지금 고를 결정 + 내린 결정 기록)
//   usage → PC 사용량(자원관리부 측정기), activity → PC 작업 추적(바깥 세션·AI 프로그램)
//   그 밖의 문서 → 본문 미리보기
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Markdown } from './Markdown.jsx';
import { DocBody } from './DocBody.jsx';
import { DecisionCard, reopen, runNow } from './DocPage.jsx';
import { LastRun, RunMeta } from './TaskBits.jsx';
import { SessionCard, sessionFromTask } from './SessionCard.jsx';
import { Evidence } from './Evidence.jsx';
import { ANSWER_KINDS, useDraft, useSeen } from './useSessions.js';
import { KIND } from './TimelineView.jsx';
import { linkTarget, plain, shortTime, toolName } from './util.js';
import { UsagePanel } from './Usage.jsx';
import { ActivityPanel } from './Activity.jsx';
import { ProcessControl } from './Process.jsx';
import { UnitCommands } from './Unit.jsx';
import { TAX } from './map/layout.js';
import { TodayCards, TodoPanel, isToday } from './TodayCards.jsx';

const MIN_W = 340, MAX_W = 760;

export function Inspector({ id, ctx, width, onResize }) {
  // 왼쪽 가장자리를 끌어 너비 조절
  const drag = (e) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    const move = (ev) => onResize(Math.max(MIN_W, Math.min(MAX_W, w0 + (x0 - ev.clientX))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const task = /^W-\d{6}-\d{3}$/.test(id) ? ctx.state.tasks.find((t) => t.id === id) : null;
  return (
    <aside className="inspector" aria-label="오른쪽 패널">
      <div className="insp-grip" onPointerDown={drag} title="끌어서 너비 조절" />
      {id === 'inbox' ? <Inbox ctx={ctx} />
        : id === 'usage' ? <UsagePanel ctx={ctx} />
        : id === 'activity' ? <ActivityPanel ctx={ctx} />
        : task ? <TaskPanel task={task} ctx={ctx} />
        : id.startsWith('cc:') ? <OutsidePanel id={id} ctx={ctx} />
        : id.startsWith('todo:') ? <TodoPanel id={id} ctx={ctx} />
          : <DocPanel name={id} ctx={ctx} />}
    </aside>
  );
}

function Head({ ctx, eyebrow, title, children, onFull }) {
  return (
    <div className="insp-head">
      <div className="insp-top">
        <span className="insp-eyebrow">{eyebrow}</span>
        <span className="grow" />
        {onFull && <button className="iconbtn" onClick={onFull} title="전체 화면으로 열기 (문서 탭)"><Icon name="fit" size={14} /></button>}
        <button className="iconbtn" onClick={ctx.closePanel} title="패널 닫기 (Ctrl+.)"><Icon name="x" size={14} /></button>
      </div>
      <div className="insp-title">{title}</div>
      {children}
    </div>
  );
}

// ── 작업·세션: 머리 = 세션 카드(full), 탭 대화·결과·기록·문서, 아래 입력창(대상 고정·초안 보존)
//   cc:<세션 id> (작업 기록 전 바깥 세션)은 대화 탭만 있는 읽기 전용 패널
function TaskPanel({ task, ctx }) {
  const id = task.id;
  const s = (ctx.sessions ?? []).find((x) => x.id === id) ?? sessionFromTask(task);
  const [tab, setTab] = useState(() => { try { const t = localStorage.getItem('brain.panel.tab'); return ['chat', 'result', 'log', 'doc'].includes(t) ? t : 'chat'; } catch { return 'chat'; } });
  useEffect(() => { try { localStorage.setItem('brain.panel.tab', tab); } catch { /* 없어도 됨 */ } }, [tab]);
  const pending = ctx.pendingByTask[id] ?? [];
  const att = (ctx.attention ?? []).find((x) => x.task === id && ANSWER_KINDS.has(x.kind));
  const answer = att?.answer ?? s.run.lastAnswer ?? null;
  const ev = useEvidence(id, `${answer ?? ''}:${s.run.state}:${s.task?.status ?? ''}`);
  // 패널을 열면 이 답은 본 것 (답 열쇠 기준 — 이름만 바뀌어도 다시 새 답이 되지 않는다)
  const [, markSeen] = useSeen();
  useEffect(() => { if (answer) markSeen(id, answer); }, [id, answer, markSeen]);
  const act = (fn) => async () => { try { await fn(); ctx.refresh(); ctx.reloadSessions?.(); } catch (e) { alert(e.message); } };
  const extra = (task.status === '대기예약' || ['완료', '취소'].includes(task.status)) ? (
    <>
      {task.status === '대기예약' && <button className="sc-chip primary" onClick={act(() => runNow(task))}>지금 실행</button>}
      {['완료', '취소'].includes(task.status) && <button className="sc-chip" onClick={act(() => reopen(id))}>다시 열기</button>}
    </>
  ) : null;
  return (
    <>
      <div className="insp-head sc-head">
        <PanelTop ctx={ctx} onFull={() => ctx.open(id)} />
        <SessionCard s={s} ctx={ctx} variant="full" answer={answer} extra={extra} />
      </div>
      <div className="insp-tabs" role="tablist">
        {[['chat', '대화'], ['result', '결과'], ['log', '기록'], ['doc', '문서']].map(([k, l]) => (
          <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="insp-body">
        {tab === 'chat' && <Thread id={id} s={s} who={task.dept} ctx={ctx} ev={ev} reports={ctx.state.reports.filter((r) => linkTarget(r.task) === id)} lastRun={task.runtime?.lastRun} />}
        {tab === 'result' && <Evidence ev={ev} s={s} ctx={ctx} />}
        {tab === 'log' && <RunLog task={task} ctx={ctx} />}
        {tab === 'doc' && <TaskDoc id={id} ctx={ctx} />}
      </div>
      {pending.length > 0 && (
        <div className="insp-pinned">
          {pending.map((p) => <DecisionCard key={p.id} decision={p} ctx={ctx} />)}
        </div>
      )}
      <Reply s={s} ctx={ctx} />
    </>
  );
}

// 작업 기록 전 바깥 세션: 대화만 (읽기 전용)
function OutsidePanel({ id, ctx }) {
  const s = (ctx.sessions ?? []).find((x) => x.id === id);
  return (
    <>
      <div className="insp-head sc-head">
        <PanelTop ctx={ctx} />
        {s ? <SessionCard s={s} ctx={ctx} variant="full" readOnly />
          : (
            <div className="sc full t-off">
              <div className="sc-top"><i className="sc-dot" aria-hidden /><div className="sc-title"><span>바깥 세션 {id.slice(3, 11)}</span></div></div>
              <div className="sc-foot"><span className="sc-note">첫 말이 들어오면 작업이 됩니다 — 지금은 보기만</span></div>
            </div>
          )}
      </div>
      <div className="insp-tabs" role="tablist"><button role="tab" className="on">대화</button></div>
      <div className="insp-body">
        <Thread id={id} s={s ?? { id, source: '바깥', run: { state: '없음' } }} who="세션" ctx={ctx} ev={null} />
      </div>
    </>
  );
}

function PanelTop({ ctx, onFull }) {
  return (
    <div className="insp-top">
      <span className="grow" />
      {onFull && <button className="iconbtn" onClick={onFull} title="전체 화면으로 열기 (문서 탭)"><Icon name="fit" size={14} /></button>}
      <button className="iconbtn" onClick={ctx.closePanel} title="패널 닫기 (Ctrl+.)"><Icon name="x" size={14} /></button>
    </div>
  );
}

// 증거: 패널을 열 때, 그리고 답·상태가 바뀔 때만 다시 읽는다 (사건마다 읽지 않게)
function useEvidence(id, key) {
  const [ev, setEv] = useState(null);
  useEffect(() => {
    let alive = true;
    api.evidence(id).then((e) => alive && setEv(e)).catch((e) => alive && setEv({ error: e.message }));
    return () => { alive = false; };
  }, [id, key]);
  return ev;
}

// 도구 칩: 한 말 안에서 같은 한국어 이름끼리 묶는다 ("파일 고침 ×3"). 서버 label이 없으면 원이름 목록으로 (toolName은 대체용)
function toolGroups(m) {
  const list = m.toolDetails?.length ? m.toolDetails.map((t) => ({ label: t.label || '도구', name: t.name, arg: t.arg }))
    : (m.tools ?? []).map((n) => ({ label: toolName(n), name: n, arg: '' }));
  const out = [];
  for (const t of list) {
    const g = out.find((x) => x.label === t.label);
    if (g) { g.n += 1; g.names.add(t.name); if (t.arg) g.args.push(t.arg); } else out.push({ label: t.label, n: 1, names: new Set([t.name]), args: t.arg ? [t.arg] : [] });
  }
  return out;
}
function ToolChips({ m }) {
  const groups = toolGroups(m);
  if (!groups.length) return null;
  return (
    <div className="toolline">
      {groups.map((g) => (
        <span key={g.label} className="tag" title={[...g.names].join(', ') + (g.args.length ? `\n${g.args.slice(0, 8).join('\n')}` : '')}>
          {g.label}{g.n > 1 ? ` ×${g.n}` : g.args[0] ? ` · ${g.args[0]}` : ''}
        </span>
      ))}
    </div>
  );
}

// 대화: 사람이 시킨 말 하나가 실행 하나를 연다 → "실행 N번째"로 묶는다
function Thread({ id, s, who, ctx, ev, reports = [], lastRun = null }) {
  const [msgs, setMsgs] = useState(null);
  const end = useRef(null);
  const live = ctx.live[id] ?? [];
  const running = ['작업중', '여는중', '응답없음'].includes(s?.run?.state);
  useEffect(() => {
    let alive = true;
    api.messages(id).then((m) => alive && setMsgs(m)).catch(() => alive && setMsgs([]));
    return () => { alive = false; };
  }, [id, ctx.tick, s?.session]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length, live.length]);

  const runs = useMemo(() => {
    const out = [];
    for (const m of msgs ?? []) {
      if (m.role === 'user' || !out.length) out.push({ at: m.at, items: [] });
      out.at(-1).items.push(m);
    }
    return out;
  }, [msgs]);

  if (msgs == null) return <div className="empty-line">— 불러오는 중</div>;
  if (!runs.length && !running) {
    if (s?.source === '바깥') return <div className="desk-empty">이 세션의 대화 기록 파일을 찾지 못했어요 (~/.claude/projects). 훅은 받고 있으니 상태와 기록 탭은 보입니다.</div>;
    if (s?.task?.status === '대기예약') return <div className="desk-empty">예약된 일이에요. 때가 되면 세션이 열립니다 — 지금 돌리려면 위의 "지금 실행".</div>;
    return <div className="desk-empty">아직 세션을 열지 않았어요. 아래에 말을 보내면 시작합니다.</div>;
  }
  const liveTools = live.filter((x) => x.kind === 'tool').slice(-6);
  return (
    <div className="thread">
      {ev?.range?.partial && <div className="ev-partial">끝 4MB만 읽음 — 이전 기록은 접힘</div>}
      {runs.map((r, i) => (
        <section key={i} className="run">
          <div className="run-head"><span>실행 {i + 1}번째</span>{r.at && <span className="mono">{shortTime(toLocal(r.at))}</span>}</div>
          {r.items.map((m, j) => {
            const me = m.role === 'user';
            return (
              <div key={m.uuid ?? `${i}:${j}`} className={`bubble ${me ? 'me' : ''}`}>
                <div className="bubble-who">{me ? '나' : who}{m.at && <span className="mono">{hm(m.at)}</span>}</div>
                {m.text && (me ? <div className="bubble-text">{plain(m.text, 600)}</div> : <Markdown className="small" text={m.text} onOpen={ctx.open} onPreview={ctx.preview} />)}
                <ToolChips m={m} />
              </div>
            );
          })}
        </section>
      ))}
      {running && (
        <section className="run live">
          <div className="run-head"><span>지금</span></div>
          <div className="bubble">
            {s.run.now && <div className="sc-now flash" key={s.run.now} title={s.run.tool?.name ?? undefined}><span className="sc-k">지금</span><span>{s.run.now}</span></div>}
            {live.filter((x) => x.kind === 'text').slice(-1).map((x, j) => <Markdown key={j} className="small" text={x.text} onOpen={ctx.open} />)}
            {liveTools.length > 0 && <div className="toolline">{liveTools.map((x, j) => <span key={j} className="tag" title={x.name}>{x.label || toolName(x.name)}</span>)}</div>}
            <span className="sc-cursor" aria-label="작업 중" />
          </div>
        </section>
      )}
      {!running && lastRun && <LastRun run={lastRun} />}
      {reports.map((r) => (
        <button key={r.id} className="report-card" onClick={(e) => ctx.pick(r.id, e)}>
          <Icon name="doc" size={14} />
          <span className="tname">{r.title}<small>{r.id} · {shortTime(r.created)}</small></span>
          <span className="linkbtn">보고 열기</span>
        </button>
      ))}
      <div ref={end} />
    </div>
  );
}

// 실행: 진행 로그에서 뽑은 사건(시작·도구·결정·결과)을 최신순으로
function RunLog({ task, ctx }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let alive = true;
    api.timeline(null, task.id).then((e) => alive && setEvents(e)).catch(() => alive && setEvents([]));
    return () => { alive = false; };
  }, [task.id, ctx.tick]);
  const live = (ctx.live[task.id] ?? []).filter((x) => x.kind === 'tool').slice(-8).reverse();
  return (
    <div className="runlog">
      <div className="runlog-now">
        {task.runtime?.phase === '실행' ? <RunMeta runtime={task.runtime} /> : task.runtime?.lastRun ? <LastRun run={task.runtime.lastRun} /> : <span className="faint">두뇌 세션은 지금 돌고 있지 않음 — 바깥 세션의 지금 상태는 위 카드에</span>}
      </div>
      {live.length > 0 && (
        <>
          <div className="insp-sub">지금 도구</div>
          <ol className="evlog">{live.map((x, i) => <li key={i}><span className="mono">{hm(new Date(x.at).toISOString())}</span><span className="ev-kind" style={{ '--c': 'var(--accent)' }}>도구</span><span title={x.name}>{x.now || x.label || toolName(x.name)}</span></li>)}</ol>
        </>
      )}
      <div className="insp-sub">진행 기록 <span className="mono">{events?.length ?? ''}</span></div>
      {events == null ? <div className="empty-line">— 불러오는 중</div>
        : events.length === 0 ? <div className="empty-line">— 진행 로그가 아직 없음</div>
          : (
            <ol className="evlog">
              {events.map((e) => {
                const k = KIND[e.kind] ?? KIND.log;
                return <li key={`${e.at}:${e.seq}`}><span className="mono">{shortTime(e.at)}</span><span className="ev-kind" style={{ '--c': k.c }}>{k.label}</span><span>{plain(e.text, 220)}</span></li>;
              })}
            </ol>
          )}
    </div>
  );
}

function TaskDoc({ id, ctx }) {
  const [doc, setDoc] = useState(null);
  useEffect(() => { let alive = true; api.doc(id).then((d) => alive && setDoc(d)).catch(() => {}); return () => { alive = false; }; }, [id, ctx.tick]);
  if (!doc) return <div className="empty-line">— 불러오는 중</div>;
  return <div className="md-wrap"><DocBody doc={doc} ctx={ctx} /></div>;
}

// 이어 시키기 — 패널 입력창 전용. 머리에 대상(↳ W-… · 제목)을 고정, 초안은 작업마다 따로 남는다 (Enter 보내기, Shift+Enter 줄바꿈)
function Reply({ s, ctx }) {
  const [text, setText] = useDraft(s.id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const closed = ['완료', '취소'].includes(s.task?.status);
  const cc = s.id.startsWith('cc:');
  const blocked = s.source === '바깥' && !s.actions?.send;
  const send = async () => {
    if (!text.trim() || busy || blocked) return;
    setBusy(true); setMsg(null);
    try {
      const r = cc ? await api.controlSession(s.session, { message: text.trim() }) : await api.send(s.id, text.trim());
      setText('');
      setMsg({ text: `→ ${r?.when ?? s.delivery?.when ?? '보냈어요'}` });
      ctx.refresh(); ctx.reloadSessions?.();
    } catch (e) { setMsg({ text: e.message, err: true }); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!msg || msg.err) return undefined;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <div className="sc-replybox">
      <div className="sc-target" title={s.task?.title}>↳ <span className="mono">{cc ? String(s.session ?? '').slice(0, 8) : s.id}</span> · {s.task?.title ?? '바깥 세션'}</div>
      {msg && <div className={`sc-reply ${msg.err ? 'err' : ''}`} role="status">{msg.text}</div>}
      <div className="insp-reply">
        <textarea
          rows={1}
          value={text}
          disabled={blocked}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          placeholder={blocked ? (s.actions?.note ?? '이 세션엔 지시를 보낼 수 없어요') : closed ? `${s.task.status}된 작업 — 보내면 다시 이어서 합니다` : `${s.task?.dept ?? '세션'}에게 이어 시키기…`}
          aria-label="이어 시키기"
        />
        <button className="sendbtn" onClick={send} disabled={!text.trim() || busy || blocked} title="보내기 (Enter)"><Icon name="up" size={15} /></button>
      </div>
    </div>
  );
}

// ── 결재함
function Inbox({ ctx }) {
  const { pending, decided = [] } = ctx.state;
  const title = (t) => ctx.state.tasks.find((x) => x.id === t)?.title ?? t;
  return (
    <>
      <Head ctx={ctx} eyebrow={<>결재함</>} title={pending.length ? `확인 필요 ${pending.length}` : '확인할 것 없음'} />
      <div className="insp-body">
        {pending.length === 0 && <div className="empty-line">— 지금 고를 결정이 없어요. 부서가 결정을 올리면 여기에 뜹니다.</div>}
        {pending.map((p) => (
          <div key={p.id} className="inbox-item">
            <button className="inbox-task" onClick={(e) => ctx.pick(linkTarget(p.task), e)}>
              <span className="mono">{linkTarget(p.task)}</span>{title(linkTarget(p.task))}<Icon name="chev" size={12} />
            </button>
            <DecisionCard decision={p} ctx={ctx} />
          </div>
        ))}
        <div className="insp-sub">내린 결정 <span className="mono">{decided.length}</span></div>
        <ol className="decided">
          {decided.map((d) => (
            <li key={d.id}>
              <button onClick={(e) => ctx.pick(linkTarget(d.task) ?? d.id, e)}>
                <span className="mono">{shortTime(d.created)}</span>
                <span className="tname">{d.title}<small>→ {d.choice}번 {d.answer ? `“${d.answer}”` : ''}{d.note ? ` · ${d.note}` : ''}</small></span>
                <span className="mono faint">{d.dept}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

// ── 작업이 아닌 문서
function DocPanel({ name, ctx }) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { let alive = true; api.doc(name).then((d) => alive && setDoc(d)).catch((e) => alive && setErr(e.message)); return () => { alive = false; }; }, [name, ctx.tick]);
  const d = doc?.data ?? {};
  const pending = d.type === '결정' && d.status === '대기' ? [{ ...d }] : [];
  return (
    <>
      <Head ctx={ctx} eyebrow={<>{d.type ?? '문서'} · <span className="mono">{doc?.readonly ? (d.type === '폴더' ? 'dir' : 'md') : name}</span></>} title={ctx.graph?.nodes.find((n) => n.id === name)?.title ?? d.title ?? d.name ?? name} onFull={() => ctx.open(name)} />
      <div className="insp-body">
        {err && <div className="empty-line">— {err}</div>}
        {pending.map((p) => <DecisionCard key={p.id} decision={p} ctx={ctx} />)}
        {d.type === '하위' && d.dept === TAX.dept && d.name === TAX.unit && (
          <button className="inbox-task" onClick={() => ctx.go({ view: 'calendar' })}><span className="mono">세무달력</span>신고·납부 마감 달력 열기<Icon name="chev" size={12} /></button>
        )}
        {d.type === '하위' && <UnitCommands u={(ctx.state.units ?? []).find((x) => x.id === name || (x.dept === d.dept && x.name === d.name))} />}
        {d.type === '공정' && <ProcessControl p={(ctx.state.processes ?? []).find((x) => x.id === name)} ctx={ctx} />}
        {d.task &&<button className="inbox-task" onClick={(e) => ctx.pick(linkTarget(d.task), e)}><span className="mono">{linkTarget(d.task)}</span>작업 열기<Icon name="chev" size={12} /></button>}
        {doc && (isToday(d) ? <TodayCards ctx={ctx} body={doc.body} /> : <div className="md-wrap"><Markdown text={doc.body} refs={doc.refs} onOpen={ctx.open} onPreview={ctx.preview} /></div>)}
      </div>
    </>
  );
}

// 세션 시각(UTC ISO) → "2026-10-30T12:27" 지역 시각
const pad = (n) => String(n).padStart(2, '0');
function toLocal(iso) { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
const hm = (iso) => toLocal(iso).slice(11);
