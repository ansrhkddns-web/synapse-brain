// 공정 실행기 패널 (lib/pipeline.mjs): 단계 줄 · 지금 할 수 있는 일 버튼 · 승인 · 새 작업물
// 단계 표시: 세션 단계(두뇌 세션) · 명령 단계 · 사람 단계(정의 없음), 승인이 필요한 단계에는 '승인'
import { useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { linkTarget } from './util.js';

export const PHASE = {
  대기: { cls: 'off', label: '대기' },
  대기열: { cls: 'warn', label: '대기열' },
  실행: { cls: 'on', label: '실행 중' },
  승인대기: { cls: 'warn', label: '승인 대기' },
  실패: { cls: 'bad', label: '실패' },
  끝: { cls: 'off', label: '끝' },
};
const kindOf = (p, s) => { const d = p.steps?.[s]; return !d || (!d.cmd && !d.do) ? '사람' : d.cmd ? '명령' : '세션'; };

export function ProcessControl({ p, ctx }) {
  const [note, setNote] = useState('');
  const [item, setItem] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  if (!p) return null;
  const phase = p.phase ?? '대기';
  const ph = PHASE[phase] ?? PHASE.대기;
  const cur = p.stage ?? p.stages[0];
  const at = p.stages.indexOf(cur);
  const kind = kindOf(p, cur);
  const gate = p.steps?.[cur]?.gate;
  const run = linkTarget(p.run);
  const queued = (ctx.state.pipeline?.queue ?? []).indexOf(p.id);
  const act = (fn, ok) => {
    setBusy(true); setMsg(null);
    fn().then(() => { setMsg(ok); setNote(''); setItem(''); setSlug(''); ctx.refresh(); }).catch((e) => setMsg(`⚠ ${e.message}`)).finally(() => setBusy(false));
  };
  const btn = (label, fn, ok, cls = '', icon = null) => (
    <button className={`btn sm ${cls}`} disabled={busy} onClick={() => act(fn, ok)}>{icon && <Icon name={icon} size={12} />}{label}</button>
  );

  return (
    <section className="pc">
      <div className="pc-top">
        <span className={`mx-st ${ph.cls}`}><i />{ph.label}</span>
        <span className="mono">{String(at + 1).padStart(2, '0')}/{String(p.stages.length).padStart(2, '0')}</span>
        <b>{cur}</b>
        <span className="pc-kind mono">{kind}{gate ? ' · 승인' : ''}</span>
        <span className="grow" />
        {p.auto && <span className="pc-auto mono" title="승인이 필요 없는 단계가 끝나면 다음 단계를 바로 돌린다">자동 이어가기</span>}
      </div>
      <div className="pc-item"><span className="mono">작업물</span>{p.item ?? '— 아직 없음'}{p.slug && <span className="mono pc-slugv">{p.slug}</span>}</div>

      <ol className="pc-stages">
        {p.stages.map((s, i) => {
          const k = kindOf(p, s);
          const st = i < at || phase === '끝' ? 'past' : i === at ? 'cur' : '';
          const ok = p.verify?.stages?.[s];   // 문서 대조: 산출물 있음 true · 없음 false · 표시 없음 null
          return (
            <li key={s} className={`${st} k-${k} ${ok === true ? 'ok' : ok === false ? 'no' : ''}`}
              title={`${s} — ${k} 단계${p.steps?.[s]?.gate ? ', 끝나면 승인' : ''}${p.steps?.[s]?.group ? `, 그룹 ${p.steps[s].group}` : ''}${ok === true ? ' · 산출물 있음' : ok === false ? ' · 산출물 없음' : ''}`}>
              <i />{s}{p.steps?.[s]?.gate && <em>승인</em>}{ok === true && <b className="pc-ok" aria-label="산출물 있음">✓</b>}
            </li>
          );
        })}
      </ol>
      <Drift p={p} busy={busy} act={act} />

      {run && (phase === '실행' || phase === '승인대기' || phase === '실패') && (
        <button className="inbox-task" onClick={(e) => ctx.pick(run, e)}><span className="mono">{run}</span>{phase === '실행' ? '이 단계를 하는 작업' : '이 단계의 결과 보기'}<Icon name="chev" size={12} /></button>
      )}

      <div className="pc-actions">
        {phase === '대기' && (kind === '사람'
          ? <><span className="pc-hint">사람이 하는 단계 — 했으면 넘긴다</span>{btn('했음, 다음 단계로', () => api.processNext(p.id), '다음 단계로 넘김', 'primary', 'chev')}</>
          : <>{btn(`▶ "${cur}" 실행`, () => api.processRun(p.id), '단계 시작', 'primary')}{btn('건너뛰기', () => api.processNext(p.id), '다음 단계로 넘김', 'ghost')}</>)}
        {phase === '대기열' && <><span className="pc-hint">같은 그룹 일이 끝나기를 기다림{queued >= 0 ? ` (${queued + 1}번째)` : ''}</span>{btn('빼기', () => api.processStop(p.id), '대기열에서 뺌', 'danger')}</>}
        {phase === '실행' && btn('멈추기', () => api.processStop(p.id), '멈춤 — 단계 위치는 그대로, 나중에 이어서', 'danger')}
        {phase === '실패' && <>{btn('다시 돌리기', () => api.processRetry(p.id), '다시 시작', 'primary')}{btn('건너뛰기', () => api.processNext(p.id), '다음 단계로 넘김', 'ghost')}</>}
      </div>

      {phase === '승인대기' && (
        <div className="pc-gate">
          <div className="pc-hint">"{cur}" 결과를 확인하고 넘길지 고른다. 고쳐 달라면 말을 남기고 다시.</div>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="남길 말 (선택) — 다시 시킬 때는 고칠 점" />
          <div className="pc-actions">
            {btn('승인하고 다음으로', () => api.processApprove(p.id, note), '승인함', 'primary', 'check')}
            <button className="btn sm" disabled={busy || !note.trim()} onClick={() => act(() => api.processRetry(p.id, note), '고칠 점을 붙여 다시 시작')}>고쳐서 다시</button>
          </div>
        </div>
      )}

      {(phase === '끝' || phase === '대기') && (
        <div className="pc-new">
          <input value={item} onChange={(e) => setItem(e.target.value)} placeholder={phase === '끝' ? '다음 작업물 (예: 다른 영화 제목)' : '작업물 바꾸기 — 처음 단계부터'} />
          {item.trim() && <input className="pc-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="폴더 이름 (예: nosferatu)" />}
          <button className="btn sm" disabled={busy || !item.trim()} onClick={() => act(() => api.processItem(p.id, item, phase === '끝', slug), '새 작업물로 처음 단계부터')}>{phase === '끝' ? '새로 시작' : '바꾸기'}</button>
        </div>
      )}
      {msg && <div className="pc-msg">{msg}</div>}
    </section>
  );
}

// 문서 대조: 문서의 지금 단계와 실제 산출물이 어긋나면 알리고 맞출 수 있게
function Drift({ p, busy, act }) {
  const v = p.verify;
  if (!v?.checked || (!v.ahead && !v.missing?.length)) return null;
  const i = v.ahead ? p.stages.indexOf(v.ahead) : -1;
  const to = i >= 0 ? p.stages[Math.min(i + 1, p.stages.length - 1)] : null;
  return (
    <div className="pc-drift">
      {v.ahead && (
        <div>
          <span>실제 파일로는 <b>{v.ahead}</b>까지 끝나 있음 — 문서는 아직 <b>{p.stage ?? p.stages[0]}</b>.</span>
          {to && to !== p.stage && <button className="btn sm" disabled={busy || p.phase === '실행' || p.phase === '대기열'} onClick={() => act(() => api.processStage(p.id, to), `지금 단계를 "${to}"(으)로 맞춤`)}>"{to}"(으)로 맞추기</button>}
        </div>
      )}
      {v.missing?.length > 0 && <div><span>지난 단계인데 산출물이 없음: <b>{v.missing.join(', ')}</b> — 지웠거나 건너뛰었는지 확인</span></div>}
    </div>
  );
}
