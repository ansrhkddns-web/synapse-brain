// 세션 카드: 데스크·패널 머리가 같이 쓰는 부품 (서버 /api/sessions 한 줄 = 카드 한 장)
//   왼쪽 2px 상태 띠 · 6px 정사각 상태 점(작업 중만 숨쉼) · 제목 · 부서 / 하위 · 출처 · 경과
//   "지금:" 줄(서버 한국어 run.now) · 보낸 지시 줄(접수 → 포함 → 전달 확인, 취소) · 칩 · 늘 보이는 안내 한 줄(actions.note)
//   variant: compact(데스크) | full(패널 머리 — 이름 고치기·1초마다 신호 시각)
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { EditableTitle, Progress } from './TaskBits.jsx';
import { plain } from './util.js';

// 마지막 답 미리보기: 마크다운 기호(** ` [[ ]] #)는 걷어 낸다. 카드는 한 줄로, 패널(full)은 줄바꿈을 살려서
const lastPlain = (s, full) => (full
  ? String(s ?? '').replace(/\*\*|__|`|\[\[|\]\]/g, '').replace(/^#+\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim()
  : plain(s, 400));

// 상태 → 색 이름 (styles.css의 --s-work·--s-wait·--s-done·--s-err·--s-off)
export function toneOf(s) {
  const st = s?.run?.state;
  const status = s?.task?.status;
  if (['완료', '취소'].includes(status)) return 'off';
  if (['작업중', '여는중', '대기열'].includes(st)) return 'work';
  if (['입력대기', '결정대기'].includes(st) || status === '결정대기') return 'wait';
  if (st === '쉬는중') return 'done';
  if (st === '응답없음') return 'err';
  return 'off';
}
export function stateLabel(s) {
  const status = s?.task?.status;
  if (status === '완료' || status === '취소') return status;
  if (s?.run?.state === '끝남') return '세션 끝남';
  if (status === '대기예약') return '예약';
  return s?.run?.label || (s?.run?.state === '관측없음' ? '신호 없음' : '');
}

const pad = (n) => String(n).padStart(2, '0');
export const hm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const clock = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:` : '') + `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
const msOf = (v) => (v ? Date.parse(v) : NaN);
export function sinceText(v) {
  const t = msOf(v);
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}
const signalText = (v) => {
  const t = msOf(v);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  return sec < 2 ? '신호 방금' : sec < 90 ? `신호 ${sec}초 전` : `마지막 신호 ${sinceText(v)}`;
};
const tok = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString()}만` : n.toLocaleString());

function useTicker(ms) {
  const [, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

// 복사 버튼 (세션 id·파일 경로) — 복사되면 잠깐 "복사됨"
export function CopyButton({ text, label = '복사' }) {
  const [done, setDone] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { window.prompt('복사할 글', text); }
  };
  return <button className="sc-copy" onClick={copy} title={text}>{done ? '복사됨' : label}</button>;
}

// 칩·판정 동작 묶음 — 카드와 결과 탭이 같이 쓴다. 회신 한 줄은 서버가 준 when을 그대로, 오류(409 등)도 서버 말을 그대로
export function useCardActions(s, ctx, answer) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);     // { text, err }
  const [again, setAgain] = useState(null); // '다시' | '다시 돌리기' — 한 줄 입력이 펼쳐짐
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!msg || msg.err) return undefined;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  const id = s?.id;
  const cc = String(id ?? '').startsWith('cc:');
  const process = s?.task?.process ?? null;
  const ans = answer ?? s?.run?.lastAnswer ?? null;

  const run = useCallback(async (fn) => {
    setBusy(true); setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text, err: false });
      ctx.reloadSessions?.(); ctx.refresh?.();
    } catch (e) { setMsg({ text: e.message, err: true }); } finally { setBusy(false); }
  }, [ctx]);

  const sendText = (text) => run(async () => {
    const r = cc ? await api.controlSession(s.session, { message: text }) : await api.send(id, text);
    return r?.when ? `→ ${r.when}` : `→ ${s?.delivery?.when ?? '보냈어요'}`;
  });
  const chip = (name) => {
    if (['계속', '한국어로', '지금 게시'].includes(name)) return sendText(ctx.chips?.[name] ?? ({ 계속: '계속 진행해', 한국어로: '진행 상황과 답을 한국어로 적어 줘', '지금 게시': '지금 게시해' })[name]);
    if (name === '멈추기') {
      if (process) return run(async () => { await api.processStop(process); return '→ 공정을 멈췄어요 (위치는 그대로)'; });
      return run(async () => {
        const r = await api.stop(id);
        if (!r.stopped) return '→ 멈출 실행이 없어요';
        return r.how === '예약' ? `→ 멈추기 예약 — ${r.when ?? '지금 도구가 끝나면 멈춥니다'}. 이미 도는 프로그램은 PC 패널에서 끝내세요.`
          : r.how === '신호' ? '→ 바깥 작업에 멈추기 신호를 보냈어요' : '→ 멈췄어요';
      });
    }
    if (name === '확인 완료') {
      if (!ans) return setMsg({ text: '판정할 답이 아직 없어요', err: true });
      return run(async () => { await api.review(id, '완료', ans); return '→ 완료로 확인했어요'; });
    }
    if (name === '다시…') { setAgain((v) => (v === '다시' ? null : '다시')); return undefined; }
    if (name === '승인') return run(async () => { await api.processApprove(process); return '→ 승인 — 다음 단계로 넘겼어요'; });
    if (name === '다시 돌리기') { setAgain((v) => (v === '다시 돌리기' ? null : '다시 돌리기')); return undefined; }
    return undefined;
  };
  const submitAgain = () => {
    const why = note.trim();
    if (again === '다시') {
      if (!why) return setMsg({ text: '다시 시킬 이유를 한 줄 적어 주세요', err: true });
      if (!ans) return setMsg({ text: '판정할 답이 아직 없어요', err: true });
      return run(async () => { const r = await api.review(id, '다시', ans, why); setAgain(null); setNote(''); return `→ ${r.when ?? '다시 시켰어요'}`; });
    }
    if (again === '다시 돌리기') return run(async () => { await api.processRetry(process, why); setAgain(null); setNote(''); return '→ 같은 단계를 다시 돌려요'; });
    return undefined;
  };
  return { busy, msg, again, note, setNote, setAgain, chip, submitAgain, sendText };
}

// 칩 줄 + 펼쳐지는 "다시…" 입력 + 회신 한 줄
export function ChipRow({ s, a, chips, extra = null }) {
  const show = chips ?? s?.actions?.chips ?? [];
  if (!show.length && !extra && !a.msg && !a.again) return null;
  return (
    <>
      {(show.length > 0 || extra) && (
        <div className="sc-chips">
          {show.map((c) => (
            <button key={c} className={`sc-chip ${c === '확인 완료' || c === '승인' ? 'primary' : ''} ${c === '멈추기' ? 'stop' : ''} ${a.again && (c === '다시…' ? a.again === '다시' : c === a.again) ? 'on' : ''}`}
              disabled={a.busy} onClick={(e) => { e.stopPropagation(); a.chip(c); }}>{c}</button>
          ))}
          {extra}
        </div>
      )}
      {a.again && (
        <div className="sc-again" onClick={(e) => e.stopPropagation()}>
          <input autoFocus value={a.note} disabled={a.busy} onChange={(e) => a.setNote(e.target.value)}
            placeholder={a.again === '다시' ? '무엇을 다시 할지 한 줄 — Enter로 보내기' : '다시 돌릴 때 덧붙일 말 (비워도 됨) — Enter'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); a.submitAgain(); }
              if (e.key === 'Escape') { e.stopPropagation(); a.setAgain(null); }
            }} aria-label="다시 시킬 이유" />
          <button className="sc-chip primary" disabled={a.busy} onClick={a.submitAgain}>보내기</button>
        </div>
      )}
      {a.msg && <div className={`sc-reply ${a.msg.err ? 'err' : ''}`} role="status">{a.msg.text}</div>}
    </>
  );
}

// 보낸 지시 줄: 접수 → 포함 → 전달 확인
function Delivery({ s, ctx }) {
  const d = s.delivery;
  const [busy, setBusy] = useState(false);
  if (!d) return null;
  const msgs = d.messages ?? [];
  const last = (d.recent ?? []).at(-1);
  const recentOk = last?.observedAt && Date.now() - Date.parse(last.observedAt) < 30 * 60_000;
  if (!msgs.length && !d.stop && !recentOk) return null;
  const cancel = async (e, m) => {
    e.stopPropagation();
    setBusy(true);
    try { await api.cancelSession(s.session, m.id); ctx.reloadSessions?.(); } catch (err) { window.alert(err.message); } finally { setBusy(false); }
  };
  const short = (t) => (t.length > 48 ? `${t.slice(0, 47)}…` : t);
  return (
    <div className="sc-delivery">
      {msgs.length > 0 && <div className="sc-dhead">보낸 지시 {msgs.length}</div>}
      {msgs.map((m) => (
        <div key={m.id} className={`sc-dline ${m.state === '포함' ? 'inc' : ''}`}>
          <span className="sc-dtext" title={m.text}>“{short(m.text)}”</span>
          <span className="sc-dstate">{m.state === '포함' ? `포함됨 ${hm(m.includedAt)} — 세션이 받았는지 확인 중` : `접수됨 — ${d.when}`}</span>
          {s.session && <button className="sc-link" disabled={busy} onClick={(e) => cancel(e, m)}>취소</button>}
        </div>
      ))}
      {d.stop && <div className="sc-dline"><span className="sc-dstate">멈추기 예약 — 지금 도구가 끝나면 멈춥니다</span></div>}
      {recentOk && !msgs.length && <div className="sc-dline ok"><span className="sc-dstate">전달 확인 {hm(last.observedAt)}</span><span className="sc-dtext" title={last.text}>“{short(last.text)}”</span></div>}
    </div>
  );
}

export function SessionCard({ s, ctx, variant = 'compact', answer = null, readOnly = false, onOpen = null, unseen = false, extra = null, head = null }) {
  const full = variant === 'full';
  useTicker(full ? 1000 : 10000);
  const a = useCardActions(s, ctx, answer);
  if (!s) return null;
  const tone = toneOf(s);
  const { task, run } = s;
  const where = task ? (task.unit ? `${task.dept} / ${task.unit}` : task.dept) : (run.cwd ? run.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('\\') : '작업 기록 전');
  const elapsed = run.startedAt && ['작업중', '여는중', '입력대기', '응답없음'].includes(run.state) ? clock(Math.max(0, Math.round((Date.now() - Date.parse(run.startedAt)) / 1000))) : '';
  const quiet = ['작업중', '응답없음', '입력대기'].includes(run.state) ? signalText(run.lastAt) : run.lastAt ? sinceText(run.lastAt) : '';
  const isW = /^W-\d{6}-\d{3}$/.test(s.id);
  const title = task?.title ?? (run.lastText ? run.lastText.slice(0, 40) : `세션 ${String(s.session ?? '').slice(0, 8)}`);
  const open = (e) => {
    if (!onOpen || e.target.closest('button, input, textarea, a, select')) return;
    onOpen(e);
  };
  return (
    <div className={`sc ${full ? 'full' : 'compact'} t-${tone} ${onOpen ? 'clickable' : ''}`} onClick={open} onAuxClick={open}
      role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(e); } : undefined}>
      {head}
      <div className="sc-top">
        <i className={`sc-dot ${tone === 'work' && run.state === '작업중' ? 'breath' : ''}`} aria-hidden />
        <div className="sc-title">
          {full && isW ? <EditableTitle value={title} onSave={async (t) => { await api.rename(s.id, t); ctx.refresh(); ctx.reloadSessions?.(); }} /> : <span title={title}>{title}</span>}
        </div>
        {unseen && <span className="sc-new">새 답</span>}
        <span className="sc-id mono">{isW ? s.id : String(s.session ?? '').slice(0, 8)}</span>
      </div>
      <div className="sc-sub">
        <span className={`sc-state s-${tone}`}>{stateLabel(s)}</span>
        <span>{where}</span>
        <span className="sc-src">{s.source === '없음' ? '기록만' : s.source}</span>
        {elapsed && <span className="mono">{elapsed}</span>}
        <span className="grow" />
        {quiet && <span className="sc-quiet">{quiet}</span>}
      </div>
      {run.now && (
        <div className="sc-now flash" key={run.now} title={run.tool?.name ?? undefined}>
          <span className="sc-k">지금</span><span>{run.now}</span>
          {/* 일하는 중이면 신호 막대가 뛴다 — 도구가 바뀔 때마다 줄이 한 번 빛난다(key) */}
          {['작업중', '여는중'].includes(run.state) && <span className="sc-eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>}
        </div>
      )}
      {run.notice && run.state === '입력대기' && <div className="sc-now warn"><span className="sc-k">기다림</span><span>{run.notice}</span></div>}
      {run.lastText && ['쉬는중', '끝남', '관측없음'].includes(run.state) && <div className={`sc-last ${full ? '' : 'clip'}`}><span className="sc-k">마지막 답</span><span>{lastPlain(run.lastText, full)}</span></div>}
      {run.progress && <Progress runtime={{ progress: run.progress, stalled: run.state === '응답없음' }} compact />}
      <Delivery s={s} ctx={ctx} />
      {!readOnly && <ChipRow s={s} a={a} extra={extra} />}
      {readOnly && extra && <div className="sc-chips">{extra}</div>}
      <div className="sc-foot">
        {s.actions?.note && <span className="sc-note">{readOnly && s.id.startsWith('cc:') ? '첫 말이 들어오면 작업이 됩니다 — 지금은 보기만' : s.actions.note}</span>}
        <span className="grow" />
        {run.tokensToday ? <span className="sc-tok mono">오늘 {tok(run.tokensToday)} 토큰</span> : null}
      </div>
    </div>
  );
}

// 세션 목록에 없는 작업(오래전에 끝난 일 등)도 카드 모양으로
export function sessionFromTask(t) {
  if (!t) return null;
  const closed = ['완료', '취소'].includes(t.status);
  const state = t.runtime?.phase === '실행' ? '작업중' : t.runtime?.phase === '대기열' ? '대기열' : t.status === '결정대기' ? '결정대기' : t.status === '검수' ? '쉬는중' : closed ? '끝남' : '없음';
  const label = { 작업중: '작업 중', 대기열: '대기열', 결정대기: '결정 기다림', 쉬는중: '답 왔음', 끝남: '끝남', 없음: '' }[state];
  return {
    id: t.id, session: t.session ?? null, source: t.session ? '두뇌' : '없음',
    task: { title: t.title, dept: t.dept, unit: t.unit ?? null, status: t.status, created: t.created, updated: t.updated, schedule: t.schedule ?? null, process: null },
    run: { state, label, now: t.runtime?.now ?? t.runtime?.step ?? '', tool: null, lastText: t.runtime?.lastText ?? null, lastAnswer: null, startedAt: null, lastAt: null, quietSec: null, observedAt: t.updated, notice: null, progress: null, cwd: null, tokensToday: null },
    delivery: null,
    actions: { send: true, stop: state === '작업중', review: t.status === '검수', run: t.status === '대기예약', chips: [], note: closed ? `${t.status}된 작업 — 보내면 다시 이어서 합니다` : null },
  };
}
