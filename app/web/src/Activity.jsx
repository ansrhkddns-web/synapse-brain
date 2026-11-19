// PC 작업 (자원관리부 추적): 두뇌가 띄우지 않은 Claude Code 세션과 AI 프로그램(/api/activity).
// 지도에서는 부서·하위 항목 아래 카드로 뜨고, 오른쪽 패널(?p=activity)에서 전부를 본다. 서버는 누가 볼 때만 읽는다.
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Share } from './Usage.jsx';
import { ago, toolName } from './util.js';

const EVERY = 5000;

export function useActivity(on = true, withPull = false) {
  const [a, setA] = useState(null);
  const [n, setN] = useState(0);
  const again = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!on) return undefined;
    let alive = true;
    const pull = () => api.activity().then((x) => { if (alive) setA(x); }).catch(() => {});
    pull();
    const t = setInterval(pull, EVERY);
    return () => { alive = false; clearInterval(t); };
  }, [on, n]);
  return withPull ? [a, again] : a;
}

export const STATE = {
  작업중: { cls: 'on', label: '작업 중' },
  응답없음: { cls: 'warn', label: '응답 없음' },
  입력대기: { cls: 'warn', label: '입력 대기' },
  쉬는중: { cls: 'off', label: '쉬는 중' },
  끝남: { cls: 'off', label: '끝남' },
};
// 작업 중이면 지금 하는 일, 쉬면 마지막 답. 서버 세션 조회(/api/sessions)의 한국어 run.now를 먼저 쓰고,
// 없을 때만(훅 없는 세션) 도구 원이름을 화면 말로 바꾼다 (toolName은 대체용)
const tool = (t) => `${toolName(t.name)}${t.arg ? ` · ${t.arg}` : ''}`;
export const nowLine = (s, sessions = null) => {
  const run = sessions?.find((x) => x.session === s.id)?.run;
  if (s.state === '작업중' && run?.now) return run.now;
  return s.state === '작업중' && s.tool ? tool(s.tool) : s.text ?? (s.tool ? tool(s.tool) : s.prompt) ?? '—';
};
export const where = (x) => (x.dept ? (x.unit ? `${x.dept} / ${x.unit}` : x.dept) : '어디 일인지 모름');
const shortPath = (p) => (p ? p.split(/[\\/]/).filter(Boolean).slice(-2).join('\\') : '');

// 오른쪽 패널: 세션(작업 중 → 응답 없음 → 쉬는 중)과 프로그램 전부
export function ActivityPanel({ ctx }) {
  const [a, again] = useActivity(true, true);
  const tk = useTokens();
  const tokOf = (id) => tk?.sessions.find((x) => x.id === id);
  const order = { 입력대기: 0, 작업중: 1, 응답없음: 2, 쉬는중: 3, 끝남: 4 };
  const sessions = (a?.sessions ?? []).slice().sort((x, y) => order[x.state] - order[y.state]);
  const title = (id) => ctx.state.tasks.find((t) => t.id === id)?.title ?? id;
  return (
    <>
      <div className="insp-head">
        <div className="insp-top">
          <span className="insp-eyebrow">자원관리부 / PC 작업 추적</span>
          <span className="grow" />
          <button className="iconbtn" onClick={() => ctx.inspect('usage')} title="PC 사용량 보기"><Icon name="fit" size={14} /></button>
          <button className="iconbtn" onClick={ctx.closePanel} title="패널 닫기 (Ctrl+.)"><Icon name="x" size={14} /></button>
        </div>
        <div className="insp-title">PC에서 도는 AI 일</div>
        <div className="ug-note">두뇌가 띄우지 않은 Claude Code 세션(최근 30분)과 AI 프로그램 · 5초마다 · 만지는 경로로 부서를 가린다</div>
      </div>
      <div className="insp-body usage-panel">
        {!a && <div className="ug-empty">읽는 중…</div>}
        {a && (
          <>
            <TokenSummary tk={tk} />
            <h4 className="ug-h">Claude Code 세션 <span className="num">{sessions.length}</span></h4>
            {sessions.length ? sessions.map((s) => {
              const st = STATE[s.state];
              return (
                <div key={s.id} className={`ax-item ${st.cls}`} style={{ '--c': ctx.deptColor[s.dept] ?? 'var(--faint)' }}>
                  <div className="ax-top">
                    <span className={`mx-st ${st.cls}`}><i />{st.label}</span>
                    <b>{s.title}</b>
                    <span className="grow" />
                    <span className="mono">{ago(s.lastAt)}</span>
                  </div>
                  <div className="ax-where"><i />{where(s)}{s.proc && <span className="mono"> · 공정 {s.proc}</span>}<span className="grow" /><span className="mono">{s.open ? '앱에 열림' : '닫힘'}</span></div>
                  {s.prompt && <div className="ax-line"><span className="mono">시킨 말</span>{s.prompt}</div>}
                  <div className="ax-line"><span className="mono">{s.state === '작업중' ? '지금' : '마지막'}</span>{nowLine(s, ctx.sessions)}</div>
                  {s.state === '작업중' && s.text && s.tool && <div className="ax-line quiet"><span className="mono">말</span>{s.text}</div>}
                  {s.notice && <div className="ax-line warn"><span className="mono">기다림</span>{s.notice}</div>}
                  {s.usage && <div className="ax-line"><span className="mono">사용량</span><Share x={s.usage} /></div>}
                  {tokOf(s.id) && <div className="ax-line"><span className="mono">토큰</span>오늘 {tok(tokOf(s.id).total)} · 응답 {tokOf(s.id).calls}번 · 출력 {tok(tokOf(s.id).output)}</div>}
                  {s.tasks.map((id) => <button key={id} className="inbox-task" onClick={(e) => ctx.pick(id, e)}><span className="mono">{id}</span>{title(id)}<Icon name="chev" size={12} /></button>)}
                  {s.hooked ? <SessionControl s={s} onDone={again} /> : <div className="ax-line quiet"><span className="mono">제어</span>훅이 연결되지 않아 보기만 — 전역 훅 설치 뒤 움직인 세션부터 지시·멈추기가 된다</div>}
                  <div className="ax-foot mono" title={s.cwd}>{shortPath(s.cwd)} · {s.id.slice(0, 8)}</div>
                </div>
              );
            }) : <div className="ug-empty">최근 30분 안에 움직인 세션이 없어요.</div>}

            <h4 className="ug-h">AI 프로그램 <span className="num">{a.programs.length}</span></h4>
            {a.programs.length ? a.programs.map((g) => (
              <div key={g.key} className="ax-item" style={{ '--c': ctx.deptColor[g.dept] ?? 'var(--faint)' }}>
                <div className="ax-top"><b className="mono">{g.label}</b>{g.count > 1 && <span className="mono"> ×{g.count}</span>}<span className="grow" /><Share x={g} /></div>
                <div className="ax-where"><i />{where(g)}{g.session && <span className="mono"> · 세션 {a.sessions.find((s) => s.id === g.session)?.title ?? g.session.slice(0, 8)}</span>}</div>
                {g.tasks.map((id) => <button key={id} className="inbox-task" onClick={(e) => ctx.pick(id, e)}><span className="mono">{id}</span>{title(id)}<Icon name="chev" size={12} /></button>)}
                <div className="ax-foot mono ax-row">pid {g.pids.join(', ')}<span className="grow" /><StopProgram g={g} onDone={again} /></div>
              </div>
            )) : <div className="ug-empty">{a.warming ? '사용량 측정기를 켜는 중…' : '지금 도는 AI 프로그램(ollama·python·ffmpeg 등)이 없어요.'}</div>}
            <NotifyRow />
            <div className="ug-note">어디 일인지는 부서·하위 항목 문서의 workdir·match와 공정의 workdir로 가린다. 틀리면 그 문서의 match에 경로 조각을 더한다.</div>
          </>
        )}
      </div>
    </>
  );
}

// 바깥 세션 제어 (훅): 지시 보내기 · 멈추기 · 대기 중인 명령 · 최근 사건
function SessionControl({ s, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(false);
  const run = (p) => {
    setBusy(true); setMsg(null);
    p.then((r) => { setMsg(r?.when ?? '취소함'); setText(''); onDone(); }).catch((e) => setMsg(e.message)).finally(() => setBusy(false));
  };
  const send = () => text.trim() && run(api.controlSession(s.id, { message: text }));
  const working = s.state === '작업중' || s.state === '입력대기' || s.state === '응답없음';
  const pend = s.pending ?? { stop: false, messages: [] };
  const short = (m) => `"${m.length > 40 ? `${m.slice(0, 39)}…` : m}"`;
  return (
    <div className="ax-ctl">
      <div className="ax-send">
        <textarea rows={1} value={text} placeholder={working ? '지시 보내기 — 이번 턴 끝에 이어서 한다' : '지시 보내기 — 다음 턴 시작 때 붙는다'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn sm primary" disabled={busy || !text.trim()} onClick={send}>보내기</button>
        {working && <button className="btn sm danger" disabled={busy || pend.stop} onClick={() => run(api.controlSession(s.id, { stop: true }))} title="다음 도구를 쓰기 전에 세션을 멈춘다">{pend.stop ? '멈추는 중' : '멈추기'}</button>}
      </div>
      {(pend.stop || pend.messages.length > 0) && (
        <div className="ax-pend">
          <span className="mono">대기</span>
          <span className="grow">{[pend.stop && '멈추기', ...pend.messages.map(short)].filter(Boolean).join(' · ')}</span>
          <button className="linkbtn" onClick={() => run(api.cancelSession(s.id))}>취소</button>
        </div>
      )}
      {msg && <div className="ax-line quiet"><span className="mono">→</span>{msg}</div>}
      {s.events?.length > 0 && (
        <>
          <button className="linkbtn ax-evbtn" onClick={() => setOpen((v) => !v)}>최근 사건 {s.events.length} {open ? '접기' : '보기'}</button>
          {open && <ol className="ax-events">{s.events.slice().reverse().map((e, i) => <li key={i}><span className="mono">{e.at.slice(11, 19)}</span><b>{e.kind}</b><span>{e.text}</span></li>)}</ol>}
        </>
      )}
    </div>
  );
}

// AI 프로그램 끝내기 (확인 후 프로세스 나무째)
function StopProgram({ g, onDone }) {
  const [busy, setBusy] = useState(false);
  const stop = () => {
    if (!window.confirm(`${g.label} (pid ${g.pids.join(', ')})과 그 아래 프로세스를 끝낼까요? 저장 안 된 작업은 잃습니다.`)) return;
    setBusy(true);
    api.stopProgram(g.key).then(onDone).catch((e) => window.alert(e.message)).finally(() => setBusy(false));
  };
  return <button className="btn sm danger" disabled={busy} onClick={stop}>{busy ? '끝내는 중' : '끝내기'}</button>;
}

// Claude 사용량 (토큰): 오늘 · 최근 5시간 창 · 많이 쓴 세션 (30초마다)
export function useTokens() {
  const [t, setT] = useState(null);
  useEffect(() => {
    let alive = true;
    const pull = () => api.tokens().then((x) => alive && setT(x)).catch(() => {});
    pull();
    const id = setInterval(pull, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return t;
}
export const tok = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString()}만` : n.toLocaleString());

function TokenSummary({ tk }) {
  if (!tk) return null;
  const share = (x) => (x.total ? Math.round((x.cacheRead / x.total) * 100) : 0);
  return (
    <div className="tk">
      <div className="tk-cell"><span className="mono">오늘</span><b>{tok(tk.today.total)}</b><em>응답 {tk.today.calls}번 · 출력 {tok(tk.today.output)} · 캐시 {share(tk.today)}%</em></div>
      <div className="tk-cell"><span className="mono">최근 5시간</span><b>{tok(tk.window.total)}</b><em>{tk.window.since ? `${new Date(tk.window.since).toTimeString().slice(0, 5)}부터` : '없음'} · 출력 {tok(tk.window.output)}</em></div>
      {tk.sessions.length > 0 && (
        <ol className="tk-top">
          {tk.sessions.slice(0, 4).map((s) => (
            <li key={s.id}><span className="tk-bar" style={{ '--w': `${Math.max(3, (s.total / tk.sessions[0].total) * 100)}%` }} /><span>{s.title ?? s.id?.slice(0, 8) ?? '?'}</span><span className="mono">{tok(s.total)}</span></li>
          ))}
        </ol>
      )}
    </div>
  );
}

// 알림 상태 · 시험 알림 (설정은 app/notify.json)
function NotifyRow() {
  const [n, setN] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.notify().then(setN).catch(() => {}); }, []);
  if (!n) return null;
  return (
    <div className="nt">
      <h4 className="ug-h">알림</h4>
      <div className="nt-row">
        <span className={`mx-st ${n.toast ? 'on' : 'off'}`}><i />윈도우 {n.toast ? '켬' : '끔'}</span>
        <span className={`mx-st ${n.phone ? 'on' : 'off'}`}><i />휴대폰 {n.phone ? '켬' : '끔'}</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => api.notifyTest().then((r) => setMsg(r.ok ? '보냄 — 화면 오른쪽 아래를 확인' : '보내지 못함')).catch((e) => setMsg(e.message))}>시험 알림</button>
      </div>
      <div className="ax-line quiet"><span className="mono">종류</span>{n.kinds.join(' · ')}</div>
      {msg && <div className="ax-line quiet"><span className="mono">→</span>{msg}</div>}
      {n.history.length > 0 && <ol className="ax-events">{n.history.slice(0, 6).map((h, i) => <li key={i}><span className="mono">{h.at.slice(11, 16)}</span><b>{h.kind}</b><span>{h.title}</span></li>)}</ol>}
    </div>
  );
}
