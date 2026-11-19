// 세션 통합 조회 (데스크·패널): 두뇌 세션(runner) · 바깥 세션(훅 + 작업 기록) · 바깥 신호(external)를 한 모양으로.
//   list() → [{ id, session, source, task, run, delivery, actions }]
//     task  = 보관함 상태 (작업 없는 바깥 세션은 null — id가 "cc:<세션 id>")
//     run   = 실행 상태 (보관함과 따로): state 여는중|대기열|작업중|입력대기|결정대기|쉬는중|응답없음|관측없음|끝남|없음, now(한국어), lastAnswer(읽음·판정 열쇠)
//     actions = 화면이 칩을 그릴 근거 (서버가 정한다)
// 읽기만 한다. 대화 기록 파일은 읽지 않는다(이미 읽어 둔 것만 본다 — transcript.peek).
import crypto from 'node:crypto';
import { now as koNow, STATE } from './ko.mjs';
import { isTracked, sessionOf } from './worklog.mjs';

export const QUIET_MS = 9 * 60_000;   // 바깥 세션이 작업 중인데 이만큼 조용하면 응답 없음
const OPEN = new Set(['실행중', '결정대기', '검수', '대기예약']);
const CHIP_TEXT = { 계속: '계속 진행해', 한국어로: '진행 상황과 답을 한국어로 적어 줘', '지금 게시': '지금 게시해' };
export const chipText = (name) => CHIP_TEXT[name] ?? name;
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
const linkTarget = (v) => (typeof v === 'string' ? v.match(/^\[\[([^\]|#]+)/)?.[1] ?? null : null);

// 작업 본문의 "## 결과" — 바뀌면 새 답이다 (서버를 다시 켜도 같은 열쇠)
//   다른 작업 칸 머리말에서만 끝난다 — 예전 결과 안에 세션이 쓴 "## 제목"까지 결과다
export function resultOf(body) {
  const m = String(body ?? '').match(/(?:^|\n)## 결과\s*\n([\s\S]*?)(?=\n## (?:지시|진행 로그|결과)\s*(?:\n|$)|$)/);
  return m ? m[1].trim() : '';
}
export const answerKey = (body) => { const r = resultOf(body); return r ? `h${hash(r)}` : null; };

export function createSessions({ store, runner, hooks, external, activity = null, tokens = null, worklog = null, transcript = null, today = () => new Date() }) {
  function one(t, body, { act, tok, procs }) {
    const id = t.id;
    const rt = runner.runtime(id);
    const ext = rt.phase == null ? external.runtime(id) : null;
    const tracked = isTracked(t);
    const sid = tracked ? sessionOf(t) : (t.session ?? null);
    const source = tracked ? '바깥' : (t.session || rt.phase) ? '두뇌' : ext ? '신호' : '없음';
    const process = procs.find((p) => linkTarget(p.run) === id)?.id ?? null;
    const run = { state: '없음', now: '', tool: null, lastText: null, lastAnswer: answerKey(body), startedAt: null, lastAt: null, quietSec: null, observedAt: t.updated ?? null, notice: null, progress: null, cwd: null, tokensToday: null };
    let delivery = null;

    if (source === '두뇌') {
      const waiting = (rt.waitingPermission ?? []).length > 0;
      run.state = rt.phase === '대기열' ? '대기열'
        : rt.phase === '실행' ? (waiting ? '입력대기' : rt.step === '세션 여는 중' ? '여는중' : '작업중')
          : t.status === '결정대기' ? '결정대기' : t.status === '검수' ? '쉬는중'
            : ['완료', '취소'].includes(t.status) ? '끝남' : t.status === '실행중' ? '관측없음' : '없음';
      run.now = rt.phase === '실행' ? (rt.now ?? rt.step ?? '답 쓰는 중') : koNow(null, run.state === '끝남' ? '끝남' : '쉬는중');
      run.tool = rt.tool ?? null;
      run.lastText = rt.lastText ?? null;
      run.startedAt = iso(rt.startedAt); run.lastAt = iso(rt.lastSignal);
      if (waiting) run.notice = '권한 요청 — 내 차례에서 허용·거부를 고르세요';
      delivery = { stop: false, when: rt.phase === '실행' ? '지금 턴이 끝나면 이어서 합니다' : '보내면 세션이 바로 이어서 합니다', messages: [], recent: [] };
    } else if (source === '바깥') {
      const h = sid ? hooks.get(sid) : null;
      const a = !h && sid ? act?.find((x) => x.id === sid) : null;
      if (h) {
        const quiet = Date.now() - Date.parse(h.lastAt);
        run.state = h.ended ? '끝남' : h.state === '작업중' && quiet > QUIET_MS ? '응답없음' : h.state;
        run.now = run.state === '응답없음' ? `응답 없음 · 마지막: ${h.now}` : h.now;
        run.tool = h.tool; run.lastText = h.lastText; run.notice = h.notice; run.lastAt = h.lastAt; run.observedAt = h.lastAt;
        run.cwd = h.cwd; run.quietSec = Math.round(quiet / 1000);
        delivery = h.delivery;
      } else if (a) {
        // 훅이 연결되지 않은 세션(훅 설치 전에 열린 세션): 대화 기록으로 짐작 — 지시는 못 보낸다
        run.state = a.state === '작업중' ? '작업중' : a.state === '응답없음' ? '응답없음' : '쉬는중';
        run.now = koNow(a.tool, run.state); run.tool = a.tool ?? null; run.lastAt = a.lastAt; run.observedAt = a.lastAt; run.cwd = a.cwd;
        run.lastText = a.text ?? null;
      } else {
        run.state = ['완료', '취소'].includes(t.status) ? '끝남' : '관측없음';
        run.now = run.state === '끝남' ? STATE.끝남 : '지금은 신호가 없어요';
      }
      run.tokensToday = tok?.get(sid) ?? null;
    } else if (source === '신호') {
      run.state = ext.stalled ? '응답없음' : '작업중';
      run.now = ext.step ?? '바깥에서 도는 중';
      run.startedAt = ext.startedAt ?? null; run.lastAt = iso(ext.beat ? Date.parse(ext.beat) : null) ?? ext.beat ?? null;
      run.progress = ext.total ? { pct: ext.pct ?? Math.round((ext.done / ext.total) * 100), done: ext.done, total: ext.total, unit: ext.unit ?? null, eta: ext.eta ?? null } : null;
    } else {
      run.state = t.status === '대기예약' ? '없음' : ['완료', '취소'].includes(t.status) ? '끝남' : '없음';
      run.now = t.status === '대기예약' ? `예약 · ${t.schedule ?? ''}` : '';
    }
    run.label = STATE[run.state] ?? (run.state === '관측없음' ? '신호 없음' : run.state === '없음' ? '' : run.state);
    if (run.lastAt && run.quietSec == null) run.quietSec = Math.round((Date.now() - Date.parse(run.lastAt)) / 1000);

    const ev = transcript?.peek?.(sid) ?? null;   // 이미 읽어 둔 증거만
    return { id, session: sid, source, task: { title: t.title, dept: t.dept, unit: t.unit ?? null, status: t.status, created: t.created, updated: t.updated, schedule: t.schedule ?? null, process }, run, delivery, actions: actions({ source, run, task: t, process, hooked: !!(sid && hooks.get(sid)), artifacts: ev?.evidence?.artifacts?.length ?? 0 }) };
  }

  // §4.3 칩 규칙 — 상태마다 보이는 칩과 늘 보일 안내 한 줄
  function actions({ source, run, task, process, hooked, artifacts }) {
    const st = run.state;
    const live = ['작업중', '응답없음', '입력대기', '여는중'].includes(st);
    const a = { send: false, stop: false, review: false, run: false, chips: [], note: null };
    if (process) {
      a.chips = ['승인', '다시 돌리기', '멈추기'];
      a.note = `공정 단계 작업 — 판정은 공정 버튼으로`;
      a.stop = live;
      return a;
    }
    if (task.status === '대기예약') { a.run = true; a.note = `예약 · ${task.schedule ?? ''}`; return a; }
    if (source === '신호') { a.stop = live; a.chips = live ? ['멈추기'] : []; a.note = '신호로만 보이는 작업 — 지시는 보낼 수 없어요'; return a; }
    const canSend = source === '두뇌' || (source === '바깥' && hooked && st !== '끝남');
    a.send = canSend;
    a.stop = live && (source === '두뇌' || hooked);
    a.review = ['검수'].includes(task.status) || (source === '바깥' && task.status === '실행중' && st === '쉬는중');
    const pub = artifacts > 0 ? ['지금 게시'] : [];
    if (st === '작업중' || st === '응답없음') a.chips = [...(canSend ? ['계속', '한국어로', ...pub] : []), ...(a.stop ? ['멈추기'] : [])];
    else if (st === '입력대기') a.chips = a.stop ? ['멈추기'] : [];
    else if (a.review) a.chips = ['확인 완료', '다시…', ...(canSend ? ['계속', ...pub] : [])];
    else if (canSend && st !== '결정대기') a.chips = ['계속', ...pub];
    if (source === '바깥') {
      a.note = !hooked ? '훅이 연결되지 않은 세션 — 보기만 됩니다(앱에서 새로 열면 지시·멈추기가 됩니다)'
        : st === '작업중' ? '이번 턴이 끝나기 전에 전달'
          : st === '입력대기' ? '앱에서 답을 기다리는 중 — 지시는 그 뒤에'
            : st === '끝남' ? '세션이 끝났어요 — 앱에서 이어서 열면 전달됩니다'
              : '쉬는 중 — 다음에 앱에서 말을 보낼 때 함께 전달됩니다';
    } else if (source === '두뇌') {
      a.note = st === '작업중' ? '지금 턴이 끝나면 이어서 합니다' : st === '결정대기' ? '결정을 고르면 이어서 합니다' : '보내면 세션이 바로 이어서 합니다';
    }
    return a;
  }

  function list() {
    const files = store.files();
    const bodyOf = new Map(files.filter((f) => f.data?.type === '작업').map((f) => [f.data.id, f.body]));
    const tasks = store.listTasks();
    const procs = store.processes();
    let act = null;
    try { act = activity?.snapshot?.().sessions ?? null; } catch { act = null; }
    let tok = null;
    try { tok = new Map((tokens?.snapshot?.().sessions ?? []).map((s) => [s.id, s.total])); } catch { tok = null; }
    const day = today().toISOString().slice(0, 10);
    const keep = (t) => OPEN.has(t.status) || runner.runtime(t.id).phase != null || external.runtime(t.id)
      || (isTracked(t) && hooks.get(sessionOf(t)) && !hooks.get(sessionOf(t)).ended) || String(t.updated ?? '').startsWith(day);
    const out = tasks.filter(keep).map((t) => one(t, bodyOf.get(t.id), { act, tok, procs }));

    // 작업이 아직 없는 바깥 세션 (훅은 왔는데 첫 말 전) — 데스크엔 보이고 패널은 읽기 전용
    const known = new Set(out.map((s) => s.session).filter(Boolean));
    for (const t of tasks) { const s = sessionOf(t); if (s) known.add(s); }
    for (const h of hooks.list()) {
      if (known.has(h.id) || h.ended) continue;
      if (worklog?.taskOf?.(h.id)) continue;
      const quiet = Date.now() - Date.parse(h.lastAt);
      const state = h.state === '작업중' && quiet > QUIET_MS ? '응답없음' : h.state;
      out.push({
        id: `cc:${h.id}`, session: h.id, source: '바깥', task: null,
        run: { state, label: STATE[state] ?? state, now: h.now, tool: h.tool, lastText: h.lastText, lastAnswer: h.lastAnswer, startedAt: null, lastAt: h.lastAt, quietSec: Math.round(quiet / 1000), observedAt: h.lastAt, notice: h.notice, progress: null, cwd: h.cwd, tokensToday: tok?.get(h.id) ?? null },
        delivery: h.delivery,
        actions: { send: true, stop: ['작업중', '입력대기', '응답없음'].includes(state), review: false, run: false, chips: state === '작업중' ? ['계속', '멈추기'] : ['계속'], note: '첫 말이 들어오면 작업 기록이 됩니다' },
      });
    }
    return out;
  }

  const get = (id) => list().find((s) => s.id === id) ?? null;
  return { list, get, actions };
}
