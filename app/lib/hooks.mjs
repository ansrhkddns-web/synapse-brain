// Claude Code 훅 받기 (자원관리부 PC 작업 추적·제어) — scripts/hook.mjs가 사건마다 POST /api/hooks.
// 관측: 사건으로 세션 상태를 바로 안다 (기록 파일 훑기보다 정확·빠름).
//   작업중 = 사람 말·도구 사용 / 입력대기 = 권한·질문 알림 / 쉬는중 = 턴 끝 / 끝남 = 세션 종료
// 제어: 화면에서 보낸 명령을 다음 사건의 답으로 돌려준다 (훅 출력 스키마 — code.claude.com/docs/en/hooks).
//   멈추기  → 다음 PreToolUse에 continue:false (도구를 쓰기 전에 세션이 멈춘다)
//   지시    → 작업 중이면 Stop에 decision:block + reason (턴을 끝내지 않고 그 지시로 이어 간다)
//             쉬는 중이면 다음 UserPromptSubmit에 additionalContext로 붙인다
// 문서: SessionStart에 그 폴더가 어느 부서·하위 항목·공정 일인지와 문서 경로를 알려 준다.
import path from 'node:path';
import { classify, makeRules } from './activity.mjs';
import { now as koNow, STATE } from './ko.mjs';

const KEEP = 60;                 // 세션마다 최근 사건 수
const FORGET_MS = 6 * 3600_000;  // 이보다 오래 조용한 세션은 잊는다
const RESEND_MS = 3 * 60_000;    // 훅 응답에 실은 지시가 이만큼 관측되지 않으면 다시 싣는다 (훅이 응답을 못 받았을 수 있다)
let seq = 0;
const mid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function toolArg(input = {}) {
  if (input.file_path) return path.basename(String(input.file_path));
  if (input.description) return clip(input.description, 70);
  if (input.command) return clip(input.command, 70);
  if (input.pattern) return clip(input.pattern, 50);
  if (input.url) return clip(input.url, 60);
  return '';
}
const toolPaths = (input = {}) => [input.file_path, input.path, input.notebook_path, ...(String(input.command ?? '').match(/[A-Za-z]:[\\/][^"'`\n\r|<>*?;]+/g) ?? [])].filter(Boolean).map(String);

export function createHooks({ store, emit = () => {}, now = () => Date.now() }) {
  const sessions = new Map();   // id → 상태·최근 사건·대기 중인 명령

  const rules = () => makeRules({ depts: store.depts(), units: store.units(), processes: store.processes() });
  const docsOf = (w) => {
    if (!w.dept) return [];
    const base = path.join(store.root, '부서', w.dept);
    return [path.join(base, '규칙.md'), w.unit && path.join(base, '하위', `${w.unit}.md`), w.proc && path.join(base, '공정', `${w.proc}.md`)].filter(Boolean);
  };

  const get = (id) => {
    let s = sessions.get(id);
    if (!s) {
      s = { id, cwd: null, transcript: null, state: '쉬는중', startedAt: now(), lastAt: now(), tool: null, prompt: null, notice: null, events: [], paths: [], pending: { stop: false, messages: [] }, delivered: [], ended: false };
      sessions.set(id, s);
    }
    return s;
  };
  const log = (s, kind, text) => {
    s.events.push({ at: new Date(now()).toISOString(), kind, text: clip(text, 160) });
    if (s.events.length > KEEP) s.events.splice(0, s.events.length - KEEP);
  };
  const note = (s) => emit('activity', { id: s.id, state: s.state });

  // 지시 전달 상태: 접수(서버가 받음) → 포함(훅 응답에 실음) → 관측(그 뒤 같은 세션의 사건이 옴 = 세션이 받아 움직임)
  // 포함한 지시는 바로 지우지 않는다 — 훅이 응답을 못 받았으면(1.5초 제한) RESEND_MS 뒤 다시 싣는다.
  const takeMessages = (s) => {
    const t = now();
    const m = s.pending.messages.filter((x) => x.state === '접수');
    if (!m.length) return null;
    for (const x of m) { x.resent = !!x.includedAt; x.state = '포함'; x.includedAt = new Date(t).toISOString(); }
    return m.map((x) => (x.resent ? `(다시 보냄) ${x.text}` : x.text)).join('\n\n');
  };
  const observe = (s) => {
    const t = now();
    for (const x of s.pending.messages.filter((y) => y.state === '포함')) {
      x.state = '관측'; x.observedAt = new Date(t).toISOString();
      s.delivered.push(x);
      log(s, '전달 확인', x.text);
    }
    if (s.delivered.length > 5) s.delivered.splice(0, s.delivered.length - 5);
    s.pending.messages = s.pending.messages.filter((y) => y.state !== '관측');
  };
  const recheck = (s) => {
    const t = now();
    for (const x of s.pending.messages) {
      if (x.state === '포함' && t - Date.parse(x.includedAt) > RESEND_MS) { x.state = '접수'; log(s, '응답 지연', `다시 실을 예정: ${x.text}`); }
    }
  };
  const fromBrain = (text) => `[SYNAPSE BRAIN] 사용자가 관제 화면에서 이 세션에 보낸 지시:\n${text}`;

  // 훅 사건 하나 → 상태 갱신, 돌려줄 훅 출력(JSON) 또는 null
  function handle(ev) {
    const id = ev?.session_id;
    if (!id || typeof id !== 'string') return null;
    const s = get(id);
    s.lastAt = now();
    // 앞서 훅 응답에 실은 지시가 있으면, 이 사건이 왔다는 것 자체가 세션이 받았다는 신호다
    observe(s);
    recheck(s);
    if (ev.cwd) s.cwd = ev.cwd;
    if (ev.transcript_path) s.transcript = ev.transcript_path;
    let out = null;

    switch (ev.hook_event_name) {
      case 'SessionStart': {
        s.ended = false; s.state = '쉬는중';
        log(s, '시작', ev.source ?? '');
        const w = classify(rules(), [s.cwd].filter(Boolean));
        const docs = docsOf(w);
        if (docs.length) {
          out = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
            `[SYNAPSE BRAIN] 이 폴더의 일은 ${[w.dept, w.unit, w.proc && `공정 ${w.proc}`].filter(Boolean).join(' / ')} 소관이다. 일하는 방식·단계는 다음 문서를 따른다(필요할 때 읽는다): ${docs.join(' · ')}. 이 세션은 관제 화면 지도에 '바깥 세션'으로 보인다.` } };
        }
        break;
      }
      case 'UserPromptSubmit': {
        s.state = '작업중'; s.notice = null; s.prompt = clip(ev.prompt, 200);
        log(s, '사람', ev.prompt);
        const m = takeMessages(s);
        if (m) { out = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: fromBrain(m) } }; log(s, '전달', m); }
        break;
      }
      case 'PreToolUse': {
        s.state = '작업중'; s.notice = null;
        s.tool = { name: ev.tool_name, arg: toolArg(ev.tool_input) };
        s.paths.push(...toolPaths(ev.tool_input));
        if (s.paths.length > 40) s.paths.splice(0, s.paths.length - 40);
        log(s, '도구', `${ev.tool_name}${s.tool.arg ? ` · ${s.tool.arg}` : ''}`);
        if (s.pending.stop) {
          s.pending.stop = false; s.state = '쉬는중';
          log(s, '멈춤', '관제 화면에서 멈춤');
          out = {
            continue: false, stopReason: 'SYNAPSE BRAIN 관제 화면에서 멈춤',
            hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '사용자가 SYNAPSE BRAIN 관제 화면에서 이 세션을 멈췄다. 더 진행하지 말고 멈춘다.' },
          };
        }
        break;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure':
        s.state = '작업중';
        if (ev.hook_event_name === 'PostToolUseFailure') log(s, '실패', ev.tool_name ?? '');
        break;
      case 'Notification': {
        const kind = ev.notification_type ?? '';
        const msg = ev.message ?? '';
        if (/idle/.test(kind)) s.state = '쉬는중';
        else { s.state = '입력대기'; s.notice = clip(`${/permission/.test(kind) || /permission/i.test(msg) ? '권한 요청' : '질문'}: ${msg}`, 140); }
        log(s, '알림', msg);
        break;
      }
      case 'Stop': {
        s.tool = null; s.pending.stop = false;
        const m = takeMessages(s);
        if (m) {
          s.state = '작업중';
          log(s, '전달', m);
          out = { decision: 'block', reason: fromBrain(m) };
        } else {
          s.state = '쉬는중';
          s.lastText = clip(ev.last_assistant_message ?? '', 300) || null;
          s.lastAnswer = `a${now().toString(36)}${(seq++).toString(36)}`;   // 이 턴 끝의 답 열쇠 (읽음·판정)
          s.lastAnswerAt = new Date(now()).toISOString();
          log(s, '턴 끝', ev.last_assistant_message ?? '');
        }
        break;
      }
      case 'SessionEnd':
        s.state = '끝남'; s.ended = true; s.tool = null;
        log(s, '끝', ev.reason ?? '');
        break;
      default:
        log(s, ev.hook_event_name ?? '사건', '');
    }
    note(s);
    return out;
  }

  // 화면에서 보낸 명령
  function control(id, { stop = false, message = null } = {}) {
    const s = sessions.get(id);
    if (!s || s.ended) return { ok: false, error: '훅으로 연결된 세션이 아님 (전역 훅 설치 후 새로 시작했거나 움직인 세션만)' };
    if (stop) { s.pending.stop = true; log(s, '명령', '멈추기 요청'); }
    let msg = null;
    if (message?.trim()) {
      msg = { id: mid(), text: message.trim().slice(0, 4000), state: '접수', at: new Date(now()).toISOString(), includedAt: null, observedAt: null };
      s.pending.messages.push(msg);
      log(s, '명령', `지시: ${message}`);
    }
    note(s);
    const v = view(s);
    return { ok: true, when: v.delivery.when, message: msg, pending: v.pending, delivery: v.delivery };
  }
  // 취소: 메시지 하나(msgId) 또는 대기 명령 전부
  function cancel(id, msgId = null) {
    const s = sessions.get(id);
    if (!s) return { ok: false };
    if (msgId) s.pending.messages = s.pending.messages.filter((x) => x.id !== msgId);
    else s.pending = { stop: false, messages: [] };
    log(s, '명령', msgId ? '지시 하나 취소' : '대기 명령 취소');
    note(s);
    return { ok: true };
  }

  // 지시가 언제 닿는지 사람 말로 (바깥 세션은 스스로 다시 움직이지 않는다는 것을 숨기지 않는다)
  const whenText = (s) => (s.ended ? '세션이 끝났어요 — 앱에서 이어서 열면 전달됩니다'
    : s.state === '작업중' ? '이번 턴이 끝나기 전에 전달'
      : s.state === '입력대기' ? '앱에서 답을 기다리는 중 — 지시는 그 뒤에 전달'
        : '쉬는 중 — 다음에 앱에서 말을 보낼 때 함께 전달');
  const view = (s) => {
    recheck(s);
    return {
      id: s.id, cwd: s.cwd, transcript: s.transcript, state: s.state, stateLabel: STATE[s.state] ?? s.state,
      now: koNow(s.tool, s.state), lastAt: new Date(s.lastAt).toISOString(), tool: s.tool, prompt: s.prompt, notice: s.notice,
      lastText: s.lastText ?? null, lastAnswer: s.lastAnswer ?? null, lastAnswerAt: s.lastAnswerAt ?? null,
      events: s.events.slice(-20), paths: s.paths.slice(-20), ended: s.ended,
      // 예전 모양(글 목록) — 지도·PC 작업 추적 화면 호환
      pending: { stop: s.pending.stop, messages: s.pending.messages.map((m) => m.text) },
      delivery: { stop: s.pending.stop, when: whenText(s), messages: s.pending.messages.map((m) => ({ ...m })), recent: s.delivered.slice(-3) },
    };
  };
  function list() {
    const t = now();
    for (const [id, s] of sessions) if (t - s.lastAt > FORGET_MS) sessions.delete(id);
    return [...sessions.values()].map(view);
  }

  return { handle, control, cancel, list, get: (id) => (sessions.has(id) ? view(sessions.get(id)) : null) };
}
