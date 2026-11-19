// 문서 페이지: md 하나를 위키 페이지로. 작업이면 세션 대화와 결재가 같이 붙는다
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Markdown } from './Markdown.jsx';
import { DocBody } from './DocBody.jsx';
import { RightSidebar } from './RightSidebar.jsx';
import { TodayCards, isToday } from './TodayCards.jsx';
// 편집기(CodeMirror)는 편집을 열 때만 불러온다
const LiveEditor = lazy(() => import('./editor/LiveEditor.jsx').then((m) => ({ default: m.LiveEditor })));
import { DeptTag, EditableTitle, Kind, LastRun, RunMeta, StatusTag } from './TaskBits.jsx';
import { OPEN_STATUSES, linkTarget, scheduleText, shortTime, toolName } from './util.js';

const TYPE_KO = { 작업: '작업', 결정: '결정', 보고서: '보고서', 일지: '일지', 지표: '지표', 부서: '부서', 하위: '하위 항목', 총괄: '총괄', 참고: '참고', 폴더: '폴더', 주인말: '주인 말', 검수판정: '검수 판정', 세션지시: '세션 지시', 기억카드: '기억 카드', 배움: '배움' };

function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    fn().then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, error];
}

export function DocPage({ name, ctx }) {
  const [doc, error] = useLoad(() => api.doc(name), [name, ctx.tick]);
  const isTask = /^W-\d{6}-\d{3}$/.test(name);
  const [tab, setTab] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); setTab((t) => (t === 'edit' ? 'doc' : 'edit')); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) return <div className="page"><div className="eyebrow">문서 없음</div><h1 className="doc-title">{name}</h1><p className="muted">{error}</p></div>;
  if (!doc) return <div className="page"><div className="eyebrow">불러오는 중 · {name}</div></div>;

  const d = doc.data ?? {};
  // 세션이 있는 작업은 세션부터, 아니면 문서부터
  const shown = doc.readonly && tab === 'edit' ? 'doc' : tab ?? (isTask && d.session ? 'session' : 'doc');
  const task = isTask ? ctx.state.tasks.find((t) => t.id === name) ?? { ...d, runtime: {} } : null;
  const pending = isTask ? ctx.pendingByTask[name] ?? [] : d.type === '결정' && d.status === '대기' ? [d] : [];

  return (
    <div className="page">
      <div className="eyebrow">
        <span className="ebox" />
        {TYPE_KO[d.type] ?? '문서'} · <b>{doc.readonly ? (d.type === '폴더' ? '폴더' : '참고 문서') : doc.name}</b>{d.dept ? <> · {d.dept}</> : null}
        <span style={{ marginLeft: 'auto' }} className="faint">{doc.readonly ? doc.rel.split('/').slice(-2).join('/') : doc.rel}</span>
      </div>
      <h1 className="doc-title">{isTask && d.title ? <EditableTitle value={d.title} onSave={async (t) => { await api.rename(name, t); ctx.refresh(); }} /> : d.title ?? (d.type === '일지' ? d.date : d.type === '기억카드' ? d.rule : d.type === '주인말' ? `주인 말 ${d.date}` : d.type === '검수판정' ? `검수 판정 ${d.date}` : d.type === '세션지시' ? `세션 지시 ${d.date}` : doc.name)}</h1>

      <div className="layout-doc">
        <div style={{ minWidth: 0 }}>
          <Props d={d} task={task} ctx={ctx} pending={pending} />
          {isTask && <TaskActions task={task} ctx={ctx} />}
          {pending.map((p) => <DecisionCard key={p.id} decision={p} ctx={ctx} />)}
          {d.type === '결정' && d.status === '결정됨' && (
            <div className="decision" style={{ borderColor: 'var(--line-2)', background: 'var(--surface)' }}>
              <div className="eyebrow">답함</div>
              <div className="decision-q">→ {d.choice}번 “{d.options?.[d.choice - 1]}”{d.note ? ` · ${d.note}` : ''}</div>
            </div>
          )}

          <div className="ptabs" role="tablist">
            {isTask && <button role="tab" className={shown === 'session' ? 'on' : ''} onClick={() => setTab('session')}><Icon name="bolt" size={13} />세션</button>}
            <button role="tab" className={shown === 'doc' ? 'on' : ''} onClick={() => setTab('doc')}><Icon name="doc" size={13} />문서</button>
            {doc.readonly
              ? <span className="readonly-note" title="부서 작업 폴더의 원본 — 고칠 땐 원본 폴더에서">읽기 전용 · 참고 문서</span>
              : <button role="tab" className={shown === 'edit' ? 'on' : ''} onClick={() => setTab('edit')} title="라이브 프리뷰 편집 (Ctrl+E로 읽기/편집 전환)"><Icon name="edit" size={13} />편집</button>}
          </div>
          {shown === 'session' && isTask && <Session task={task} ctx={ctx} />}
          <div className="doc-body">
            {shown === 'doc' && (isToday(d) ? <TodayCards ctx={ctx} body={doc.body} /> : <DocBody doc={doc} ctx={ctx} />)}
            {shown === 'edit' && <Suspense fallback={<div className="empty-line">편집기 불러오는 중…</div>}><LiveEditor doc={doc} ctx={ctx} /></Suspense>}
          </div>
        </div>

        <RightSidebar ctx={ctx} doc={doc} name={name} />
      </div>
    </div>
  );
}


function Props({ d, task, ctx, pending }) {
  const rows = [];
  if (task) rows.push(['상태', <StatusTag key="s" task={task} pending={pending} />]);
  else if (d.status) rows.push(['상태', <span key="s" className={`tag ${d.status === '대기' ? 'warn' : ''}`}>{d.status}</span>]);
  if (d.dept) rows.push(['부서', <DeptTag key="d" name={d.dept} color={ctx.deptColor[d.dept]} />]);
  if (d.kind) rows.push(['종류', <span key="k" className="tag">{d.kind}</span>]);
  if (task && scheduleText(task)) rows.push(['예약', <span key="sc" className="tag num">{scheduleText(task)}</span>]);
  if (d.last_run) rows.push(['마지막 실행', <span key="lr" className="mono">{d.last_run.replace('T', ' ')}</span>]);
  if (d.created) rows.push(['만든 때', <span key="c" className="mono">{String(d.created).replace('T', ' ')}</span>]);
  if (d.updated) rows.push(['고친 때', <span key="u" className="mono">{String(d.updated).replace('T', ' ')}</span>]);
  if (d.date) rows.push(['날짜', <span key="dt" className="mono">{d.date}</span>]);
  if (d.path) rows.push(['원본', <span key="pa" className="mono faint" style={{ overflowWrap: 'anywhere' }}>{d.path}</span>]);
  if (d.session) rows.push(['세션', <span key="se" className="mono faint">{String(d.session).slice(0, 8)}…</span>]);
  if (!rows.length) return null;
  return <div className="props">{rows.map(([k, v]) => [<div key={`${k}k`} className="pk">{k}</div>, <div key={`${k}v`} className="pv">{v}</div>])}</div>;
}

// 끝난 일 다시 열기: 이유를 물어 검수 판정으로 남긴다 (취소하면 열지 않음)
export async function reopen(id) {
  const why = prompt('다시 여는 이유 (기억에 검수 판정으로 남아요 · 비워도 됨)', '');
  if (why === null) return;
  await api.setStatus(id, '검수', why.trim() || null);
}

// 지금 실행: 반복 틀은 때와 상관없이 하위 작업을 하나 더 만드니 한 번 묻는다 (정기 실행은 그대로)
export async function runNow(task) {
  if (task.repeat && !confirm(`반복 예약 "${task.title}"을 지금 한 번 더 돌릴까요?\n정기 실행(${scheduleText(task)})은 그대로 남아요.`)) return;
  await api.runNow(task.id);
}

function TaskActions({ task, ctx }) {
  const act = (fn) => async () => { try { await fn(); ctx.refresh(); } catch (e) { alert(e.message); } };
  const running = task.runtime?.phase != null;
  const closed = ['완료', '취소'].includes(task.status);
  return (
    <div className="actions">
      {task.status === '대기예약' && <button className="btn primary" onClick={act(() => runNow(task))}><Icon name="play" />지금 실행</button>}
      {task.status === '검수' && <button className="btn primary" onClick={act(() => api.setStatus(task.id, '완료'))}><Icon name="check" />확인 · 완료</button>}
      {running && <button className="btn" onClick={act(() => api.stop(task.id))}><Icon name="stop" />멈추기</button>}
      {!closed && <button className="btn ghost danger" onClick={act(() => confirm('이 프로세스를 취소할까요?') && api.setStatus(task.id, '취소'))}><Icon name="x" />취소</button>}
      {closed && <button className="btn ghost" onClick={act(() => reopen(task.id))}>다시 열기</button>}
    </div>
  );
}

export function DecisionCard({ decision, ctx }) {
  const [full, setFull] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState(false);
  useEffect(() => { api.decision(decision.id).then(setFull).catch(() => {}); }, [decision.id]);
  const choose = async (n) => {
    setBusy(true);
    try { await api.answer(decision.id, n, note.trim() || null); ctx.refresh(); } catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <div className={`decision ${decision.kind === '권한' ? 'perm' : ''}`}>
      <div className="eyebrow">{decision.kind === '권한' ? '권한 요청' : decision.kind === '기억' ? '기억 카드 · 기억할까요?' : decision.kind === '스킬' ? '배움 → 스킬 · 만들까요?' : '결정'} · <b>{decision.id}</b><span style={{ marginLeft: 'auto' }}>{shortTime(decision.created)}</span></div>
      <div className="decision-q">{decision.title}</div>
      <div className="options">
        {decision.options.map((o, i) => (
          <button key={i} className={`option ${decision.recommended === i + 1 ? 'rec' : ''}`} disabled={busy} onClick={() => choose(i + 1)}>
            <span className="n">{i + 1}</span><span className="o-t">{o}</span>
            {decision.recommended === i + 1 && <span className="tag acc">추천</span>}
          </button>
        ))}
      </div>
      <input className="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="덧붙일 말 (선택)" aria-label="메모" />
      {full?.body && (
        <>
          <button className="linkbtn" onClick={() => setWhy((v) => !v)}>{why ? '근거 접기' : '근거 보기'}</button>
          {why && <div style={{ marginTop: 8 }}><Markdown className="small" text={full.body} onOpen={ctx.open} /></div>}
        </>
      )}
    </div>
  );
}

function Session({ task, ctx }) {
  const [msgs, setMsgs] = useState([]);
  const end = useRef(null);
  const live = ctx.live[task.id] ?? [];
  const color = ctx.deptColor[task.dept];
  useEffect(() => {
    let alive = true;
    api.messages(task.id).then((m) => alive && setMsgs(m)).catch(() => {});
    return () => { alive = false; };
  }, [task.id, ctx.tick, task.session]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs.length, live.length]);

  if (!task.session && !live.length) return <div className="empty-line">— 세션이 아직 시작되지 않음</div>;
  const running = task.runtime?.phase === '실행';
  return (
    <div className="chat">
      {!running && <LastRun run={task.runtime?.lastRun} />}
      {msgs.map((m) => {
        const me = m.role === 'user';
        return (
          <div key={m.uuid} className="msg">
            <div className={`avatar ${me ? 'me' : 'dept'}`} style={{ '--c': color }}>{me ? '나' : task.dept[0]}</div>
            <div style={{ minWidth: 0 }}>
              <div className="msg-who"><b>{me ? '나' : task.dept}</b>{me ? '지시' : '답'}</div>
              {m.text && <Markdown className="small" text={m.text} onOpen={ctx.open} onPreview={ctx.preview} />}
              {m.tools.length > 0 && <div className="toolline">{(m.toolDetails?.length ? m.toolDetails : m.tools.map((name) => ({ name, label: toolName(name) }))).map((t, i) => <span key={i} className="tag" title={t.name}>{t.label || toolName(t.name)}{t.arg ? ` · ${t.arg}` : ''}</span>)}</div>}
            </div>
          </div>
        );
      })}
      {running && (
        <div className="msg">
          <div className="avatar dept" style={{ '--c': color }}>{task.dept[0]}</div>
          <div style={{ minWidth: 0 }}>
            <div className="msg-who"><b>{task.dept}</b>지금</div>
            {live.filter((x) => x.kind === 'text').slice(-1).map((x, i) => <Markdown key={i} className="small" text={x.text} onOpen={ctx.open} />)}
            <div className="toolline">{live.filter((x) => x.kind === 'tool').slice(-6).map((x, i) => <span key={i} className="tag acc" title={x.name}>{x.label || toolName(x.name)}</span>)}</div>
            <RunMeta runtime={task.runtime} />
            <div className="typing"><i /><i /><i /></div>
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

