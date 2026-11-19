// 여러 화면이 같이 쓰는 작은 조각
import { useEffect, useState } from 'react';
import { ago, pctTag, toolName } from './util.js';

// 상태: 점 하나 + 글자. 움직이는 건 실행 중·대기열 점뿐 (전문가도구 리서치 R12·R13)
export function StatusTag({ task, pending, since = false }) {
  const t = pctTag(task, pending);
  const live = task.runtime?.phase != null;
  return (
    <span className={`st st-${t.cls || 'none'} ${live ? 'live' : ''}`}>
      <i />{t.text === 'running' ? '실행 중' : t.text === 'queued' ? '대기열' : t.text}
      {since && <em>{ago(task.updated)}</em>}
    </span>
  );
}

// 작업 이름: 눌러서 고친다. Enter·밖 누르기 = 저장, Esc = 그만 (onSave가 실패하면 알림)
export function EditableTitle({ value, onSave }) {
  const [edit, setEdit] = useState(null);
  const save = async () => {
    const next = edit?.replace(/\s+/g, ' ').trim();
    setEdit(null);
    if (next && next !== value) { try { await onSave(next); } catch (e) { alert(e.message); } }
  };
  if (edit == null) return <button className="etitle" onClick={() => setEdit(value)} title="눌러서 이름 바꾸기">{value}</button>;
  return (
    <input className="etitle-edit" autoFocus maxLength={60} value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.stopPropagation(); setEdit(null); }
      }} />
  );
}

export function DeptTag({ name, color }) {
  return <span className="tag" style={{ '--c': color }}><span className="dot" style={{ '--c': color }} /><b>{name}</b></span>;
}

// 트리·그래프·목록이 같이 쓰는 문서 종류 표시 점
export function Kind({ type, color, live, decide, done }) {
  const cls = ['kind', `k-${type}`, live && 'live', decide && 'decide', done && 'done'].filter(Boolean).join(' ');
  return <span className={cls} style={{ '--c': color }}><i /></span>;
}

// 실행 중인 세션 한 줄: 경과 · 지금 하는 일(서버 한국어 runtime.now 먼저) · 도구 수 · 마지막 신호 (1초마다 다시 그린다)
export function RunMeta({ runtime }) {
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (!runtime?.startedAt) return null;
  const sec = (ms) => Math.max(0, Math.round((Date.now() - ms) / 1000));
  const quiet = sec(runtime.lastSignal);
  return (
    <div className="runmeta">
      <span className="num">{clock(sec(runtime.startedAt))}</span>
      <span>{runtime.now ?? (runtime.step && /^[A-Za-z_]/.test(runtime.step) ? toolName(runtime.step) : runtime.step)}</span>
      <span>{runtime.external ? '바깥 작업' : `도구 ${runtime.tools}`}</span>
      <span className={quiet > 90 ? 'stale' : ''}>신호 {quiet < 2 ? '방금' : `${quiet}초 전`}</span>
      {runtime.progress && <Progress runtime={runtime} />}
    </div>
  );
}

// 지난 실행 기록: 걸린 시간 · 턴 · 토큰 · 비용
export function LastRun({ run }) {
  if (!run) return null;
  return (
    <div className="runmeta">
      <span>지난 실행</span><span className="num">{clock(Math.round(run.ms / 1000))}</span>
      <span>{run.turns}턴</span>
      {run.tokens > 0 && <span>토큰 {run.tokens.toLocaleString()}</span>}
      {run.cost > 0 && <span>${run.cost.toFixed(3)}</span>}
    </div>
  );
}

const clock = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:` : '') + `${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// 바깥 일 진행률 (external 신호의 done·total): 막대 + % · 몇/몇 · 남은 시간 · 멈춤 의심
// total이 없으면 막대는 흐르기만 하고 센 수만 보인다
export function Progress({ runtime, compact = false }) {
  const p = runtime?.progress;
  if (!p) return null;
  const pct = p.pct == null ? null : Math.floor(p.pct);
  const n = (v) => (p.unit === '초' ? clock(Math.round(v)) : Number(v).toLocaleString());
  const count = p.total ? `${n(p.done)} / ${n(p.total)}${p.unit && p.unit !== '초' ? ` ${p.unit}` : ''}` : `${n(p.done)}${p.unit && p.unit !== '초' ? ` ${p.unit}` : ''}`;
  return (
    <div className={`prog ${runtime.stalled ? 'stalled' : ''} ${compact ? 'compact' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
      <div className={`prog-bar ${pct == null ? 'indet' : ''}`}><i style={pct == null ? undefined : { width: `${pct}%` }} /></div>
      <div className="prog-meta">
        {pct != null && <b>{pct}%</b>}
        <span>{count}</span>
        <span className="grow" />
        {runtime.stalled ? <em>멈춤 의심</em> : p.eta != null && <span>남은 {eta(p.eta)}</span>}
      </div>
    </div>
  );
}
const eta = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}시간 ${Math.round((s % 3600) / 60)}분` : s >= 60 ? `${Math.round(s / 60)}분` : `${s}초`);
