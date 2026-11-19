// 예전 개요 (#/overview — 첫 화면은 데스크로 옮겼다): 큰 제목 + 숫자, 결정 → 실행 중 → 열린 작업 표 → 최근 기록
import { Icon } from './icons.jsx';
import { api } from './api.js';
import { useState } from 'react';
import { DeptTag, RunMeta, StatusTag } from './TaskBits.jsx';
import { OPEN_STATUSES, isToday, linkTarget, shortTime, taskLine, toolName } from './util.js';

const pad = (n) => String(n).padStart(2, '0');

const DESC = {
  null: '부서들이 맡은 일을 처리하고, 모든 과정은 위키 문서로 쌓인다. 사람은 결정만 한다.',
};

export function Overview({ ctx, dept }) {
  const { state, open, live } = ctx;
  const [allDecisions, setAllDecisions] = useState(false);
  const all = state.tasks.filter((t) => !dept || t.dept === dept);
  const openTasks = all.filter((t) => OPEN_STATUSES.includes(t.status)).sort((a, b) => b.updated.localeCompare(a.updated));
  const running = all.filter((t) => t.runtime.phase != null);
  const pending = state.pending.filter((p) => !dept || p.dept === dept);
  const doneToday = all.filter((t) => ['검수', '완료'].includes(t.status) && isToday(t.updated)).length;
  const recent = all.filter((t) => ['검수', '완료'].includes(t.status)).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6);
  const reports = state.reports.filter((r) => !dept || r.dept === dept).slice(0, 6);
  const deptInfo = dept ? state.depts.find((d) => d.name === dept) : null;
  const units = (state.units ?? []).filter((u) => u.dept === dept);

  return (
    <div className="page">
      <div className="eyebrow">
        <span className="ebox" />
        {dept ? <>부서 {pad(deptInfo?.order ?? 0)} · <b>{dept}</b>{units.length ? <> · 하위 항목 {units.length}</> : null}</> : <>두뇌 · <b>개요</b></>}
      </div>
      <div className="hero">
        <div className="hero-left">
          <h1 className="display">{dept ?? '관제실'}</h1>
          <div className="hero-actions">
            <button className="btn" onClick={ctx.openPalette}><Icon name="search" />{dept ? `${dept}에서 찾기` : '두뇌에서 찾기'}<kbd>Ctrl K</kbd></button>
            <button className="btn ghost" onClick={ctx.focusCommand}><Icon name="plus" />새 일</button>
            <button className="btn ghost" onClick={() => ctx.go({ view: 'map', dept })}><Icon name="map" />지도<kbd>Alt 2</kbd></button>
          </div>
        </div>
        <div>
          <p className="hero-desc">{dept ? (deptInfo?.summary ? `${deptInfo.summary}. ` : '') + '맡은 프로세스와 결정, 남긴 기록. 아래 명령 막대로 바로 일을 맡길 수 있다.' : DESC.null}</p>
          <div className="stats">
            <Stat label="열린 프로세스" value={openTasks.length} />
            <Stat label="내 결정" value={pending.length} tone={pending.length ? 'warn' : ''} />
            <Stat label="실행 중" value={running.length} tone={running.length ? 'acc' : ''} />
            <Stat label="오늘 끝남" value={doneToday} />
          </div>
        </div>
      </div>

      <div className="chiprow">
        <span className="lbl"><Icon name="filter" size={12} />{dept ? '하위 항목' : '부서'}</span>
        {dept ? (
          <>
            {units.map((u) => {
              const n = state.tasks.filter((t) => t.dept === dept && t.unit === u.name && OPEN_STATUSES.includes(t.status)).length;
              return <button key={u.name} className="chipbtn" onClick={() => ctx.open(`하위:${dept}/${u.name}`)} title={u.summary ?? ''}><span className="dot" style={{ '--c': deptInfo?.color, borderRadius: 2 }} />{u.name}<span className="num">{n}</span></button>;
            })}
            <button className="chipbtn" onClick={async () => { const name = prompt(`${dept}에 추가할 하위 항목 이름`); if (name?.trim()) { try { const { id } = await api.createUnit({ dept, name: name.trim() }); ctx.refresh(); ctx.open(id); } catch (e) { alert(e.message); } } }}><Icon name="plus" size={12} />하위 항목</button>
          </>
        ) : state.depts.map((d) => {
          const n = state.tasks.filter((t) => t.dept === d.name && OPEN_STATUSES.includes(t.status)).length;
          return <button key={d.name} className="chipbtn" onClick={() => ctx.go({ view: 'desk', dept: d.name })}><span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{pad(d.order ?? 0)}</span><span className="dot" style={{ '--c': d.color }} />{d.name}<span className="num">{n}</span></button>;
        })}
        <span className="lbl" style={{ marginLeft: 14 }}>기록</span>
        <button className="chipbtn" onClick={() => ctx.open(state.journals[0]?.name)} disabled={!state.journals.length}>일지<span className="num">{state.journals.length}</span></button>
        <button className="chipbtn" onClick={() => state.reports[0] && ctx.open(state.reports[0].id)} disabled={!state.reports.length}>보고서<span className="num">{state.reports.length}</span></button>
      </div>

      {pending.length > 0 && (
        <section className="sec">
          <div className="sec-head"><h2>결정 대기</h2><span className="mono">{pending.length}개 · 사람이 골라야 진행</span><span className="grow" />{pending.length > 6 && <button className="linkbtn" onClick={() => setAllDecisions((v) => !v)}>{allDecisions ? '접기' : `모두 보기 ${pending.length}`}</button>}</div>
          <div className="bento">
            {(allDecisions ? pending : pending.slice(0, 6)).map((p) => (
              <button key={p.id} className="card decide" onClick={(e) => ctx.pick(linkTarget(p.task), e)}>
                <div className="card-top"><span>{p.kind === '권한' ? '권한' : '결정'} · {p.id}</span><span className="grow" /><span>{shortTime(p.created)}</span></div>
                <div className="card-title">{p.title}</div>
                <div className="card-foot">
                  {p.options.map((o, i) => <span key={i} className={`tag ${p.recommended === i + 1 ? 'acc' : ''}`}>{i + 1} · {o}</span>)}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {running.length > 0 && (
        <section className="sec">
          <div className="sec-head"><h2>실행 중</h2><span className="mono">세션 {running.length} · 실시간</span></div>
          <div className="bento">
            {running.map((t) => {
              const items = live[t.id] ?? [];
              const tools = items.filter((x) => x.kind === 'tool').slice(-4);
              return (
                <button key={t.id} className="card live" onClick={(e) => ctx.pick(t.id, e)}>
                  <div className="card-top"><StatusTag task={t} pending={ctx.pendingByTask[t.id]} since /><span className="grow" /><span>{t.id}</span></div>
                  <div className="card-title">{t.title}</div>
                  <div className="card-body">{taskLine(t, live) || '세션을 여는 중…'}</div>
                  <RunMeta runtime={t.runtime} />
                  <div className="card-foot">
                    <DeptTag name={t.dept} color={ctx.deptColor[t.dept]} />
                    {tools.map((x, i) => <span key={i} className="tag" title={x.name}>{x.label || toolName(x.name)}</span>)}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="sec">
        <div className="sec-head"><h2>열린 프로세스</h2><span className="mono">{openTasks.length}개 열림</span><span className="grow" /></div>
        {openTasks.length === 0 ? (
          <div className="emptybox">
            <Icon name="bolt" size={18} />
            <div><b>{dept ? `${dept}에 열린 프로세스가 없어요` : '열린 프로세스가 없어요'}</b>
              <p>{dept ? `${dept}에 맡길 일을 적으면 바로 세션이 시작돼요.` : '부서를 골라 일을 맡기면 세션이 시작되고, 과정이 위키 문서로 쌓여요.'}</p></div>
            <button className="btn primary" onClick={ctx.focusCommand}><Icon name="plus" />{dept ? `${dept}에 일 맡기기` : '일 맡기기'}</button>
          </div>
        ) : (
          <table className="table">
            <thead><tr><th style={{ width: 130 }}>번호</th><th>프로세스</th><th style={{ width: 120 }}>부서</th><th style={{ width: 120 }}>상태</th><th style={{ width: 70 }}>갱신</th></tr></thead>
            <tbody>
              {openTasks.map((t) => (
                <tr key={t.id} onClick={(e) => ctx.pick(t.id, e)} className={ctx.route.panel === t.id ? 'on' : ''}>
                  <td className="mono">{t.id}</td>
                  <td><div className="t-title">{t.title}</div>{taskLine(t, live) && <div className="t-sub">{taskLine(t, live)}</div>}</td>
                  <td><DeptTag name={t.dept} color={ctx.deptColor[t.dept]} /></td>
                  <td><StatusTag task={t} pending={ctx.pendingByTask[t.id]} /></td>
                  <td className="mono">{shortTime(t.updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {(recent.length > 0 || reports.length > 0) && (
        <section className="sec">
          <div className="sec-head"><h2>최근 기록</h2><span className="mono">위키 · 누적</span></div>
          <div className="bento">
            {reports.map((r) => (
              <button key={r.id} className="card" onClick={() => open(r.id)}>
                <div className="card-top"><Icon name="doc" size={12} /><span>보고서 · {r.id}</span><span className="grow" /><span>{shortTime(r.created)}</span></div>
                <div className="card-title">{r.title}</div>
                <div className="card-foot"><DeptTag name={r.dept} color={ctx.deptColor[r.dept]} />{linkTarget(r.task) && <span className="tag">↳ {linkTarget(r.task)}</span>}</div>
              </button>
            ))}
            {recent.map((t) => (
              <button key={t.id} className="card" onClick={(e) => ctx.pick(t.id, e)}>
                <div className="card-top"><span>작업 · {t.id}</span><span className="grow" /><span>{shortTime(t.updated)}</span></div>
                <div className="card-title">{t.title}</div>
                <div className="card-foot"><DeptTag name={t.dept} color={ctx.deptColor[t.dept]} /><StatusTag task={t} /></div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone = '' }) {
  return (
    <div>
      <div className="stat-l">{label}</div>
      <div className={`stat-v ${tone}`}>{value.toLocaleString('ko-KR')}</div>
    </div>
  );
}
