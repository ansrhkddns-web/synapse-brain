// 기억 탭 "배움": 일하다 알게 된 것 → 모이면 스킬 (서버 lib/learn.mjs, GET /api/learn)
//   흐름 띠: 모음 → 스킬 제안(결재) → 스킬로 만듦 · 버림
//   모으기: 세션이 일하다 바로 남김(note_learning) · 평일 18:30 그날 기록에서 뽑음 · 여기서 내가 직접 적음
//   묶기: "스킬로 묶기"를 누르거나(저녁 자동은 모인 게 3개 넘고 3일마다) → 결재함에 "스킬로 만들까요?" → 고르면 스킬관리부가 SKILL.md를 쓴다
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { shortTime } from './util.js';

const KINDS = [
  ['방법', '절차·요령'],
  ['주의', '함정과 해결'],
  ['선호', '내가 원하는 기준'],
  ['도구', '명령·경로 사용법'],
];
const BY_LABEL = { 세션: '세션이 남김', 추출: '기록에서 뽑음', 사람: '내가 적음' };
const STAGES = [
  { key: '모음', label: '모으는 중', desc: '아직 스킬로 안 간 배움' },
  { key: '제안', label: '스킬 제안', desc: '결재함에서 고르기를 기다림' },
  { key: '스킬', label: '스킬로 만듦', desc: '스킬관리부 작업이 SKILL.md를 씀' },
  { key: '버림', label: '버림', desc: '스킬로 만들지 않기로 함' },
];

export function LearnView({ ctx }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [stage, setStage] = useState('모음');
  const load = () => api.learn().then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const lessons = d?.lessons ?? [];
  const count = (k) => lessons.filter((l) => l.status === k).length;
  const shown = lessons.filter((l) => l.status === stage);
  const run = (what, fn) => async () => {
    setBusy(what); setMsg(null);
    try { setMsg(await fn()); await load(); ctx.refresh?.(); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(null); }
  };
  const extract = run('뽑기', async () => { const r = await api.learnExtract(); return { ok: r.added.length ? `오늘 기록에서 배움 ${r.added.length}개를 뽑았어요` : '오늘 기록에서 새로 뽑을 배움이 없었어요' }; });
  const propose = run('묶기', async () => { const r = await api.learnPropose(); return { ok: r.count ? `스킬 제안 ${r.count}개를 결재함에 올렸어요` : `모인 배움 ${r.open}개로는 묶을 스킬이 아직 없어요` }; });
  const serverBusy = d?.busy;

  return (
    <div className="mhome learn">
      <div className="mhome-head">
        <h2>배움 → 스킬</h2>
        <p>일하다 알게 된 것(방법·주의·선호·도구)을 모아 두고, 같은 일에 대한 배움이 모이면 <b>스킬</b>로 만들어요. 스킬은 다음에 같은 일을 할 때 Claude가 불러 그대로 따라요.</p>
      </div>

      <div className="lflow" role="tablist" aria-label="배움 단계">
        {STAGES.map((s, i) => (
          <div key={s.key} className="lflow-step">
            {i > 0 && i < 3 && <Icon name="chev" size={14} className="lflow-arrow" />}
            <button role="tab" className={`lflow-b st-${s.key} ${stage === s.key ? 'on' : ''}`} onClick={() => setStage(s.key)} title={s.desc}>
              <span>{s.label}</span><b className="mono">{count(s.key)}</b><em>{s.desc}</em>
            </button>
          </div>
        ))}
      </div>

      <div className="mhome-cols">
        <section className="mhome-main">
          <AddLesson ctx={ctx} onAdded={load} />

          <div className="lbar">
            <button className="btn sm" onClick={extract} disabled={!!busy || !!serverBusy} title="오늘 주인 말·검수 판정·바깥 세션 대화에서 배움을 뽑아요 (읽기만 하는 세션)">
              <Icon name="search" size={12} />{busy === '뽑기' || serverBusy === '배움 뽑기' ? '뽑는 중…' : '오늘 기록에서 뽑기'}
            </button>
            <button className="btn sm primary" onClick={propose} disabled={!!busy || !!serverBusy || !count('모음')} title="모인 배움을 새 스킬·있는 스킬 고침으로 묶어 결재함에 올려요">
              <Icon name="bolt" size={12} />{busy === '묶기' || serverBusy === '스킬 묶기' ? '묶는 중…' : `스킬로 묶기 (${count('모음')})`}
            </button>
            {d?.pending?.length > 0 && <button className="btn sm warn" onClick={() => ctx.inspect('inbox')}>결재 기다림 {d.pending.length}</button>}
            <span className="grow" />
            {d?.runs && <span className="lruns">{d.runs.extract ? `마지막 뽑기 ${shortTime(d.runs.extract)}` : '아직 뽑은 적 없음'}{d.runs.propose ? ` · 묶기 ${shortTime(d.runs.propose)}` : ''}</span>}
          </div>
          {msg && <div className={`lmsg ${msg.error ? 'err' : ''}`} role="status">{msg.error ?? msg.ok}</div>}
          {err && <div className="emptybox"><Icon name="clock" size={18} /><div><b>배움을 못 불러왔어요</b><p>{/없는 경로|404/.test(err) ? '두뇌 서버를 다시 시작하면 보여요.' : err}</p></div></div>}

          {d && (shown.length
            ? <LessonList list={shown} ctx={ctx} onChange={load} />
            : <div className="emptybox"><Icon name="edit" size={18} /><div><b>{stage === '모음' ? '모인 배움이 없어요' : `${STAGES.find((s) => s.key === stage).label} 배움이 없어요`}</b><p>{stage === '모음' ? '세션이 일하다 배운 것을 남기거나, 저녁에 그날 기록에서 뽑거나, 위에서 직접 적으면 여기에 쌓여요.' : '단계가 바뀌면 여기로 와요.'}</p></div></div>)}
        </section>

        <aside className="mhome-side">
          <div className="mbox">
            <div className="mbox-h"><b>이렇게 돌아가요</b></div>
            <ol className="lsteps">
              <li><b>모으기</b> — 두뇌 세션은 일하다 알게 된 것을 바로 남겨요. 평일 18:30에는 그날 고쳐 말한 것·다시 연 이유·바깥 세션 대화에서 뽑아요.</li>
              <li><b>묶기</b> — 같은 일에 대한 배움이 모이면 "새 스킬"이나 "있는 스킬 고침"으로 묶어 결재함에 올려요. (자동은 3개 넘게 모이면 3일마다)</li>
              <li><b>만들기</b> — 결재에서 <b>만든다</b>를 고르면 스킬관리부 작업이 SKILL.md를 쓰고 스킬 보드에 올려요.</li>
            </ol>
            <p className="mbox-sub">선호(내 취향)는 스킬보다 기억 카드가 맞아서, 묶을 때 빠질 수 있어요.</p>
          </div>
          <SkillList skills={d?.skills ?? []} lessons={lessons} />
        </aside>
      </div>
    </div>
  );
}

function AddLesson({ ctx, onAdded }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState('방법');
  const [dept, setDept] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(null);
    try { await api.learnAdd({ text: text.trim(), kind, dept: dept || null }); setText(''); onAdded(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="ladd">
      <div className="ladd-kinds" role="radiogroup" aria-label="배움 종류">
        {KINDS.map(([k, h]) => <button key={k} role="radio" aria-checked={kind === k} className={`lkind k-${k} ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)} title={h}>{k}</button>)}
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
        placeholder="알게 된 것을 한 줄로 — 예: PowerShell 5.1은 한글 .ps1에 UTF-8 BOM이 있어야 한다" aria-label="배움 적기" disabled={busy} />
      <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="부서">
        <option value="">모든 부서</option>
        {(ctx.state.depts ?? []).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
      </select>
      <button className="btn sm" onClick={add} disabled={!text.trim() || busy}><Icon name="plus" size={12} />남기기</button>
      {err && <div className="lmsg err">{err}</div>}
    </div>
  );
}

function LessonList({ list, ctx, onChange }) {
  // 날짜별로
  const days = useMemo(() => [...list.reduce((m, l) => m.set(l.date, [...(m.get(l.date) ?? []), l]), new Map())], [list]);
  const setState = async (l, status) => { try { await api.learnState(l.id, status); onChange(); } catch { /* 다음 갱신 때 */ } };
  return days.map(([date, ls]) => (
    <div key={date} className="lday">
      <div className="mday-h"><b>{date.slice(5).replace('-', '/')}</b><span className="mono">{ls.length}</span><span className="grow" />
        <button className="linkbtn" onClick={(e) => ctx.pick(`배움-${date}`, e)}>원문</button></div>
      {ls.map((l) => (
        <div key={l.id} className="lrow">
          <span className={`lkind k-${l.kind}`}>{l.kind}</span>
          <div className="lrow-b">
            <div className="lrow-t">{l.text}</div>
            <div className="lrow-m">
              <span>{l.time}</span>
              <span>{BY_LABEL[l.by] ?? l.by}</span>
              {l.dept && <span><i style={{ '--c': ctx.deptColor[l.dept] ?? 'var(--line-3)' }} />{l.dept}{l.unit ? ` / ${l.unit}` : ''}</span>}
              {l.task && <button className="linkbtn mono" onClick={(e) => ctx.pick(l.task, e)}>{l.task}</button>}
              {l.skill && <span className="lskill mono">{l.skill}</span>}
              {l.status === '제안' && l.decision && <button className="linkbtn" onClick={(e) => ctx.pick(l.decision, e)}>결재 {l.decision}</button>}
              {l.status === '스킬' && l.job && <button className="linkbtn" onClick={(e) => ctx.pick(l.job, e)}>스킬 작업 {l.job}</button>}
            </div>
          </div>
          <div className="lrow-a">
            {l.status === '모음' && <button className="iconbtn" onClick={() => setState(l, '버림')} title="버리기 — 스킬로 묶지 않음"><Icon name="x" size={13} /></button>}
            {l.status === '버림' && <button className="btn sm ghost" onClick={() => setState(l, '모음')}>되살리기</button>}
          </div>
        </div>
      ))}
    </div>
  ));
}

function SkillList({ skills, lessons }) {
  const [all, setAll] = useState(false);
  const fed = (name) => lessons.filter((l) => l.skill === name).length;
  const rows = all ? skills : skills.slice(0, 8);
  return (
    <div className="mbox">
      <div className="mbox-h"><b>지금 스킬</b><span className="mono">{skills.length}</span><span className="grow" /></div>
      <p className="mbox-sub">~/.claude/skills — 배움이 들어간 수를 함께 보여요.</p>
      {rows.map((s) => (
        <div key={s.name} className="lsk" title={s.description}>
          <b className="mono">{s.name}</b>{fed(s.name) > 0 && <em>배움 {fed(s.name)}</em>}
          <span>{s.description}</span>
        </div>
      ))}
      {skills.length > 8 && <button className="linkbtn" onClick={() => setAll((v) => !v)}>{all ? '접기' : `${skills.length - 8}개 더`}</button>}
      {!skills.length && <div className="empty-line">— 없음</div>}
    </div>
  );
}
