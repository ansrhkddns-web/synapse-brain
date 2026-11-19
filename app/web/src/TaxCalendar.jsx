// 세무달력 (경영지원실 / 재경부) — #/calendar
//   달 칸에 마감을 색 알약으로, 오른쪽에 고른 날(없으면 다가오는 마감)의 자세한 내용: 무엇을·언제까지·어디서·무엇을 준비·근거.
//   회사 유형(개인 일반·간이·법인)과 직원·프리랜서·기타소득 지급 여부로 거른다. "제출함"을 누르면 회사 폴더에 적어 둔다.
//   자료: 회사 폴더의 재경부\세무달력.yaml (lib/taxcal.mjs)
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';

export const TAX_COLOR = {
  부가세: '#f0b429', 원천세: '#5fb3ff', 지급명세서: '#9b8cff', 소득세: '#3ecf8e',
  법인세: '#ff8f5a', 지방세: '#e06c9f', '4대보험': '#22b8cf', 기타: '#8a93a6',
};
const FORMS = [['전체', '전체'], ['개인일반', '개인 일반'], ['개인간이', '개인 간이'], ['법인', '법인']];
const FLAGS = [['직원', '직원 있음'], ['프리랜서', '프리랜서 지급'], ['기타소득', '기타소득 지급']];
const WEEK = '일월화수목금토';
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const label = (s) => { const d = parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
const dday = (s, today) => { const n = Math.round((parse(s) - parse(today)) / 86400000); return n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`; };
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 화면은 돈다 */ } } };

// 회사 유형·지급 여부로 보일 항목인지
const visible = (it, form, flags) => {
  const t = it.대상 ?? ['모두'];
  if (t.includes('모두')) return true;
  const formal = t.filter((x) => ['개인일반', '개인간이', '법인'].includes(x));
  const flg = t.filter((x) => ['직원', '프리랜서', '기타소득'].includes(x));
  return (!formal.length || form === '전체' || formal.includes(form)) && (!flg.length || flg.some((f) => flags[f]));
};

export function TaxCalendar({ ctx }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [ci, setCi] = useState(0);
  const today = ymd(new Date());
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [day, setDay] = useState(null);
  const [form, setForm] = useState(() => store.get('brain.tax.form', '전체'));
  const [flags, setFlags] = useState(() => store.get('brain.tax.flags', { 직원: true, 프리랜서: true, 기타소득: true }));
  const [kinds, setKinds] = useState(() => new Set(store.get('brain.tax.kinds', Object.keys(TAX_COLOR))));
  const pull = () => api.taxcal().then(setData).catch((e) => setErr(e.message));
  useEffect(() => { pull(); }, []);
  useEffect(() => { store.set('brain.tax.form', form); }, [form]);
  useEffect(() => { store.set('brain.tax.flags', flags); }, [flags]);
  useEffect(() => { store.set('brain.tax.kinds', [...kinds]); }, [kinds]);

  const cal = data?.companies?.[ci];
  const byId = useMemo(() => new Map((cal?.items ?? []).map((it) => [it.id, it])), [cal]);
  const events = useMemo(() => (cal?.events ?? []).filter((e) => { const it = byId.get(e.item); return it && kinds.has(it.분류) && visible(it, form, flags); }), [cal, byId, kinds, form, flags]);
  const byDay = useMemo(() => { const m = new Map(); for (const e of events) (m.get(e.date) ?? m.set(e.date, []).get(e.date)).push(e); return m; }, [events]);
  const holidays = useMemo(() => new Set(cal?.holidays ?? []), [cal]);

  if (err) return <div className="page"><div className="empty-line">— {err}</div></div>;
  if (!data) return <div className="page"><div className="boot">세무달력 불러오는 중…</div></div>;
  if (!cal) return (
    <div className="page tx-page">
      <div className="eyebrow"><span className="ebox" />경영지원실 / 재경부</div>
      <h1 className="tx-h1">세무달력</h1>
      <div className="empty-line">— 아직 세무달력 자료가 없어요. 경영지원실 작업 폴더의 &lt;회사&gt;\재경부\세무달력.yaml을 만든다.</div>
    </div>
  );

  // 달 칸: 그 달 1일이 있는 주의 일요일부터 6주
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const move = (n) => { const d = new Date(y, m - 1 + n, 1); setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); setDay(null); };
  const inRange = (s) => s >= cal.range.from.slice(0, 7) && s <= cal.range.to.slice(0, 7);
  const upcoming = events.filter((e) => e.date >= today && !e.done).slice(0, 14);
  const overdue = events.filter((e) => e.date < today && e.date >= cal.range.from && !e.done);
  const focus = day ? (byDay.get(day) ?? []) : null;
  const toggleDone = (e) => api.taxcalDone(cal.company, e.key, !e.done).then(pull);
  const monthCount = events.filter((e) => e.date.startsWith(month)).length;

  return (
    <div className="page tx-page">
      {ctx && <button className="btn sm ghost tx-back" onClick={() => ctx.go({ view: 'map' })}><Icon name="chev" size={12} className="flip" />지도로</button>}
      <div className="tx-head">
        <div>
          <div className="eyebrow"><span className="ebox" />경영지원실 / 재경부 · 세무달력</div>
          <h1 className="tx-h1">{cal.company} 세무달력</h1>
          <div className="tx-sub mono">규칙 확인 {cal.checked ?? '—'} · 범위 {cal.range.from} ~ {cal.range.to} · 마감이 토·일·공휴일이면 다음 평일로 미룬 날짜</div>
        </div>
        {data.companies.length > 1 && (
          <div className="seg">{data.companies.map((c, i) => <button key={c.company} className={i === ci ? 'on' : ''} onClick={() => setCi(i)}>{c.company}</button>)}</div>
        )}
      </div>

      {cal.errors?.length > 0 && <div className="tx-warn">자료 형식 오류: {cal.errors.join(' / ')}</div>}
      {cal.notes?.length > 0 && (
        <details className="tx-notes" open={store.get('brain.tax.notes', true)} onToggle={(e) => store.set('brain.tax.notes', e.currentTarget.open)}>
          <summary><span className="mono">알림</span> {cal.notes.length}개 — 회사 유형 미정 · 제도 변경</summary>
          <ul>{cal.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      )}

      <div className="tx-filters">
        <span className="mono tx-lbl">회사 유형</span>
        <div className="seg">{FORMS.map(([v, t]) => <button key={v} className={form === v ? 'on' : ''} onClick={() => setForm(v)}>{t}</button>)}</div>
        <span className="mono tx-lbl">지급</span>
        {FLAGS.map(([v, t]) => (
          <button key={v} className={`tx-chip ${flags[v] ? 'on' : ''}`} onClick={() => setFlags((f) => ({ ...f, [v]: !f[v] }))} aria-pressed={!!flags[v]}><i />{t}</button>
        ))}
      </div>
      <div className="tx-filters">
        <span className="mono tx-lbl">분류</span>
        {Object.entries(TAX_COLOR).map(([k, c]) => (
          <button key={k} className={`tx-chip tx-k ${kinds.has(k) ? 'on' : ''}`} style={{ '--c': c }} aria-pressed={kinds.has(k)}
            onClick={() => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}><i />{k}</button>
        ))}
      </div>

      <div className="tx-body">
        <section className="tx-cal" aria-label={`${y}년 ${m}월`}>
          <div className="tx-nav">
            <button className="iconbtn" onClick={() => move(-1)} disabled={!inRange(ymd(new Date(y, m - 2, 1)).slice(0, 7))} title="지난달"><Icon name="chev" size={14} className="flip" /></button>
            <h2>{y}년 <b>{m}월</b></h2>
            <button className="iconbtn" onClick={() => move(1)} disabled={!inRange(ymd(new Date(y, m, 1)).slice(0, 7))} title="다음 달"><Icon name="chev" size={14} /></button>
            <span className="grow" />
            <span className="mono tx-count">이달 마감 {monthCount}</span>
            <button className="btn sm" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>오늘</button>
          </div>
          <div className="tx-grid">
            {[...WEEK].map((w, i) => <div key={w} className={`tx-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>{w}</div>)}
            {cells.map((d) => {
              const s = ymd(d);
              const list = byDay.get(s) ?? [];
              const out = d.getMonth() !== m - 1;
              const hol = holidays.has(s) || d.getDay() === 0;
              return (
                <button key={s} className={`tx-day ${out ? 'out' : ''} ${s === today ? 'today' : ''} ${s === day ? 'sel' : ''} ${hol ? 'hol' : d.getDay() === 6 ? 'sat' : ''} ${list.length ? 'has' : ''}`}
                  onClick={() => setDay(s === day ? null : s)} aria-label={`${label(s)}${list.length ? ` 마감 ${list.length}건` : ''}`}>
                  <span className="tx-num">{d.getDate()}</span>
                  {list.slice(0, 3).map((e) => {
                    const it = byId.get(e.item);
                    return <span key={e.key} className={`tx-pill ${e.done ? 'done' : ''}`} style={{ '--c': TAX_COLOR[it.분류] }} title={it.이름}>{it.짧게 ?? it.이름}</span>;
                  })}
                  {list.length > 3 && <span className="tx-more mono">+{list.length - 3}</span>}
                </button>
              );
            })}
          </div>
          <div className="tx-foot mono">공휴일 {cal.holidays.filter((h) => h.startsWith(month)).map((h) => Number(h.slice(8))).join('·') || '없음'} · 빨간 날짜는 일요일·공휴일</div>
        </section>

        <aside className="tx-side">
          {focus ? (
            <>
              <div className="tx-side-h"><b>{label(day)}</b><span className="mono">{dday(day, today)}</span><span className="grow" /><button className="linkbtn" onClick={() => setDay(null)}>다가오는 마감</button></div>
              {focus.length ? focus.map((e) => <EventCard key={e.key} e={e} it={byId.get(e.item)} today={today} onDone={() => toggleDone(e)} />)
                : <div className="empty-line">— 이날은 마감이 없어요.</div>}
            </>
          ) : (
            <>
              {overdue.length > 0 && (
                <>
                  <div className="tx-side-h warn"><b>지난 마감 · 제출함 표시 안 됨</b><span className="mono">{overdue.length}</span></div>
                  {overdue.slice(-5).map((e) => <EventCard key={e.key} e={e} it={byId.get(e.item)} today={today} compact onDone={() => toggleDone(e)} onPick={() => { setMonth(e.date.slice(0, 7)); setDay(e.date); }} />)}
                </>
              )}
              <div className="tx-side-h"><b>다가오는 마감</b><span className="mono">{upcoming.length}</span></div>
              {upcoming.map((e) => <EventCard key={e.key} e={e} it={byId.get(e.item)} today={today} compact onDone={() => toggleDone(e)} onPick={() => { setMonth(e.date.slice(0, 7)); setDay(e.date); }} />)}
            </>
          )}
        </aside>
      </div>
      <p className="tx-disclaimer">이 달력은 신고·납부 일정과 준비 자료를 정리한 참고용이에요. 금액·세율·제출은 세무사나 국세청 안내로 확인하고, 실제 제출·납부는 사람이 합니다. 자료 파일: <span className="mono">{cal.file}</span></p>
    </div>
  );
}

function EventCard({ e, it, today, compact = false, onDone, onPick }) {
  const [open, setOpen] = useState(!compact);
  if (!it) return null;
  const d = dday(e.date, today);
  const late = e.date < today && !e.done;
  return (
    <article className={`tx-ev ${e.done ? 'done' : ''} ${late ? 'late' : ''}`} style={{ '--c': TAX_COLOR[it.분류] }}>
      <header onClick={() => (compact ? setOpen((v) => !v) : null)} className={compact ? 'click' : ''}>
        <span className="tx-kind">{it.분류}</span>
        <span className={`tx-dd mono ${d === 'D-DAY' || late ? 'hot' : ''}`}>{e.done ? '제출함' : d}</span>
        <span className="grow" />
        {onPick && <button className="linkbtn mono" onClick={(ev) => { ev.stopPropagation(); onPick(); }}>{label(e.date)}</button>}
      </header>
      <h3>{it.이름}</h3>
      {e.period && <div className="tx-period">{e.period}</div>}
      {e.shifted && <div className="tx-shift mono">원래 {label(e.due)} → 휴일이라 {label(e.date)}</div>}
      {open && (
        <>
          <div className="tx-tags">{it.대상.map((t) => <span key={t} className="tag">{t === '모두' ? '모든 사업자' : t}</span>)}{it.담당 && <span className="tag mono">담당 {it.담당}</span>}</div>
          {it.할일 && <div className="tx-row"><span className="mono">할 일</span><span>{it.할일}</span></div>}
          {it.방법 && <div className="tx-row"><span className="mono">어디서</span><span>{it.방법}</span></div>}
          {it.준비?.length > 0 && (
            <div className="tx-row col"><span className="mono">준비할 것</span>
              <ul className="tx-prep">{it.준비.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {it.메모 && <div className="tx-row"><span className="mono">참고</span><span>{it.메모}</span></div>}
          {(it.근거 || it.출처) && (
            <div className="tx-row"><span className="mono">근거</span><span>{it.근거}{it.출처 && <> · <a href={it.출처} target="_blank" rel="noreferrer">출처</a></>}</span></div>
          )}
          <div className="tx-actions">
            <button className={`btn sm ${e.done ? '' : 'primary'}`} onClick={onDone}>{e.done ? `제출함 취소 (${e.done.replace('T', ' ')})` : '제출함'}</button>
          </div>
        </>
      )}
    </article>
  );
}
