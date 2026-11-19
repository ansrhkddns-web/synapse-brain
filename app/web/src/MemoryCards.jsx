// 기억 카드 탭: 사람이 승인한 규칙 한 줄들. 세션을 시작할 때 부서·하위 항목에 맞는 카드가 지시문에 붙는다.
//   그날 기록(주인 말·검수 판정)에서 후보 뽑기 → 결재함에 "기억할까요?" 카드 → 승인하면 여기에
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { linkTarget, shortTime } from './util.js';

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export function MemoryCards({ ctx }) {
  const [cards, setCards] = useState(null);
  const [date, setDate] = useState(today);
  const [run, setRun] = useState(null);      // { loading, sec } | { msg, ok }
  const [showOff, setShowOff] = useState(false);
  useEffect(() => { let alive = true; api.cards().then((c) => alive && setCards(c)).catch(() => alive && setCards([])); return () => { alive = false; }; }, [ctx.tick]);
  useEffect(() => {
    if (!run?.loading) return undefined;
    const t0 = Date.now();
    const t = setInterval(() => setRun((r) => (r?.loading ? { ...r, sec: Math.round((Date.now() - t0) / 1000) } : r)), 500);
    return () => clearInterval(t);
  }, [run?.loading]);

  const propose = async () => {
    setRun({ loading: true, sec: 0 });
    try {
      const r = await api.propose(date);
      setRun(r.count ? { ok: true, msg: `후보 ${r.count}개를 결재함에 올렸어요` } : { msg: '이 날 기록에서 새로 뽑을 규칙이 없어요' });
      if (r.count) { ctx.refresh(); ctx.inspect('inbox'); }
    } catch (e) { setRun({ msg: e.message }); }
  };
  const patch = async (id, p) => { try { await api.patchCard(id, p); ctx.refresh(); setCards(await api.cards()); } catch (e) { alert(e.message); } };

  const waiting = ctx.state.pending.filter((d) => d.kind === '기억').length;
  const on = (cards ?? []).filter((c) => c.status === '사용');
  const off = (cards ?? []).filter((c) => c.status !== '사용');
  // 적용 범위로 묶기: 모든 부서 → 부서 → 부서/하위
  const groups = new Map();
  for (const c of on) {
    const key = c.unit ? `${c.dept} / ${c.unit}` : c.dept ?? '모든 부서';
    (groups.get(key) ?? groups.set(key, []).get(key)).push(c);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '모든 부서' ? -1 : b === '모든 부서' ? 1 : a.localeCompare(b, 'ko')));

  return (
    <div className="mcards">
      <div className="mcards-head">
        <div>
          <h2>기억 카드 <span className="mono">{on.length}</span></h2>
          <p>사람이 승인한 판단 기준. 세션을 시작할 때 그 부서·하위 항목에 맞는 카드가 지시문에 붙어요.</p>
        </div>
        <div className="mcards-run">
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="기록 날짜" />
          <button className="btn primary sm" onClick={propose} disabled={run?.loading}><Icon name="bolt" size={12} />이 날 기록에서 규칙 후보 뽑기</button>
          {waiting > 0 && <button className="btn sm warn" onClick={() => ctx.inspect('inbox')}>결재 기다림 {waiting}</button>}
        </div>
      </div>
      {run && (
        <div className={`mcards-msg ${run.ok ? 'ok' : ''}`}>
          {run.loading ? <><span className="typing"><i /><i /><i /></span>주인 말·검수 판정을 읽고 규칙을 고르는 중 · {run.sec}초</> : run.msg}
        </div>
      )}

      {cards == null ? <div className="empty-line">— 불러오는 중</div>
        : on.length === 0 ? (
          <div className="emptybox">
            <Icon name="bolt" size={18} />
            <div><b>아직 기억 카드가 없어요</b><p>일을 맡기고, 결정하고, 검수하면 그 말이 기억(주인 말·검수 판정)에 쌓여요. 위 버튼으로 그날 기록에서 규칙 후보를 뽑아 결재하면 카드가 됩니다.</p></div>
          </div>
        ) : keys.map((k) => (
          <section key={k} className="mcards-group">
            <div className="facet-h">{k} <span className="mono">{groups.get(k).length}</span></div>
            {groups.get(k).map((c) => <Card key={c.id} c={c} ctx={ctx} patch={patch} />)}
          </section>
        ))}

      {off.length > 0 && (
        <section className="mcards-group">
          <button className="linkbtn" onClick={() => setShowOff((v) => !v)}>버린 카드 {off.length} {showOff ? '접기' : '보기'}</button>
          {showOff && off.map((c) => <Card key={c.id} c={c} ctx={ctx} patch={patch} />)}
        </section>
      )}
    </div>
  );
}

function Card({ c, ctx, patch }) {
  const [edit, setEdit] = useState(null);
  const save = () => { if (edit?.trim() && edit.trim() !== c.rule) patch(c.id, { rule: edit.trim() }); setEdit(null); };
  return (
    <div className={`mcard ${c.status !== '사용' ? 'off' : ''}`}>
      {edit == null
        ? <button className="mcard-rule" onClick={() => setEdit(c.rule)} title="눌러서 고치기">{c.rule}</button>
        : <input className="mcard-edit" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(); if (e.key === 'Escape') setEdit(null); }} />}
      <div className="mcard-meta">
        <button className="mono" onClick={(e) => ctx.pick(c.id, e)}>{c.id}</button>
        <span className="mono">{shortTime(c.created)}</span>
        {(c.sources ?? []).map((s) => linkTarget(s)).filter(Boolean).map((s) => (
          <button key={s} className="src" onClick={(e) => ctx.pick(s, e)} title="근거 기록 열기">{s}</button>
        ))}
        <span className="grow" />
        <button className="linkbtn" onClick={() => patch(c.id, { status: c.status === '사용' ? '버림' : '사용' })}>{c.status === '사용' ? '버리기' : '되살리기'}</button>
      </div>
    </div>
  );
}
