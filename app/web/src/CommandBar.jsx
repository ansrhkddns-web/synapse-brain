// 아래 명령 막대: 새 일 전용 (부서·하위 항목·예약). 이어서 시키기는 오른쪽 패널 입력창이 맡는다
import { forwardRef, useEffect, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';

const EXAMPLES = ['매일 07:30', '평일 09:00', '주말 10:00', '토요일 08:00'];

export const CommandBar = forwardRef(function CommandBar({ ctx, dept }, ref) {
  const { route, state } = ctx;
  const [target, setTarget] = useState(dept ?? state.depts[0]?.name ?? '');
  const [unit, setUnit] = useState('');
  const units = (state.units ?? []).filter((u) => u.dept === target);
  const [text, setText] = useState('');
  const [sched, setSched] = useState(false);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { if (dept) setTarget(dept); }, [dept]);
  useEffect(() => { setUnit(''); }, [target]);
  if (route.view === 'graph') return null;

  const submit = async () => {
    if (!text.trim() || busy || (sched && !when.trim())) return;
    setBusy(true); setErr(null);
    try {
      const { id } = await api.createTask({ dept: target, ...(unit ? { unit } : {}), instruction: text.trim(), ...(sched ? { schedule: when.trim() } : {}) });
      // 새 일은 오른쪽 패널에 연다 (가운데 보기는 그대로)
      ctx.inspect(id);
      setText(''); setSched(false); setWhen('');
      ctx.refresh(); ctx.reloadSessions?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="cmdbar-wrap">
      <div className="cmdbar">
        {err && <div className="err">{err}</div>}
        {sched && (
          <div className="cmd-sched">
            <Icon name="clock" size={13} />언제
            <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="매일 07:30 · 평일 09:00 · 토요일 08:00 · 2026-11-01T09:00" aria-label="예약 시각" autoFocus />
            {EXAMPLES.map((x) => <button key={x} className="chip" onClick={() => setWhen(x)}>{x}</button>)}
          </div>
        )}
        <div className="cmd-row">
          <span className="cmd-caret">›</span>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder={sched ? `${target}에 예약할 일…` : `${target}에게 새 일 시키기…`}
            aria-label="새 일 지시"
          />
          <button className={`togg ${sched ? 'on' : ''}`} onClick={() => setSched((v) => !v)} title="예약" aria-pressed={sched}><Icon name="clock" /></button>
          <label className="chipsel">
            {sched ? '예약 →' : '새 일 →'}
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="맡길 부서">
              {state.depts.map((d) => <option key={d.name} value={d.name}>{String(d.order ?? '').padStart(2, '0')} {d.name}</option>)}
            </select>
            {units.length > 0 && (
              <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="하위 항목">
                <option value="">› 전체</option>
                {units.map((u) => <option key={u.name} value={u.name}>› {u.name}</option>)}
              </select>
            )}
          </label>
          <button className="send" onClick={submit} disabled={!text.trim() || busy || (sched && !when.trim())} aria-label="보내기"><Icon name="up" /></button>
        </div>
      </div>
    </div>
  );
});
