// 데스크·패널이 같이 쓰는 세션 목록과 내 차례: /api/sessions · /api/attention
//   5초마다 다시 읽고, 서버 사건(session·tool·task·runtime·activity·decision·process)이 오면 300ms 모아서 바로 다시 읽는다.
//   요청마다 순번을 붙여, 늦게 도착한 옛 응답이 새 응답을 덮지 않게 한다. SSE가 다시 붙으면 다시 읽는다.
// 읽음 표시(brain.seen = {작업 id: 답 열쇠})와 패널 입력 초안(brain.draft = {작업 id: 글})도 여기서 맡는다.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, subscribe } from './api.js';

const EVERY = 5000;
const SOON = 300;
const POKE = new Set(['session', 'tool', 'task', 'runtime', 'activity', 'decision', 'process', 'result', 'open']);

// 행동 필요(내 차례) · 새 답 — 서버 attention의 kind
export const ACTION_KINDS = new Set(['결정', '권한', '입력대기', '승인', '실패', '멈춤의심']);
export const ANSWER_KINDS = new Set(['검수', '새답']);
// 돌아가는 중: 이 run.state 들 (정렬 — 입력대기 → 응답없음 → 작업중 → 여는중 → 대기열)
export const LIVE_STATES = ['입력대기', '응답없음', '작업중', '여는중', '대기열'];

export function useSessions() {
  const [data, setData] = useState({ sessions: null, attention: null, chips: {} });
  const seq = useRef(0);
  const applied = useRef(0);
  const timer = useRef(null);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [sessions, attention] = await Promise.all([api.sessions(), api.attention()]);
      if (n < applied.current) return;   // 더 새 응답이 이미 들어왔다
      applied.current = n;
      setData((d) => ({ ...d, sessions, attention }));
    } catch { /* 다음 차례에 다시 */ }
  }, []);
  const soon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, SOON);
  }, [load]);

  useEffect(() => {
    load();
    api.chips().then((chips) => setData((d) => ({ ...d, chips }))).catch(() => {});
    const t = setInterval(load, EVERY);
    const off = subscribe((event) => { if (POKE.has(event)) soon(); });
    return () => { clearInterval(t); clearTimeout(timer.current); off(); };
  }, [load, soon]);

  return { ...data, reload: load, soon };
}

// ── localStorage 한 칸을 여러 부품이 같이 보는 작은 저장소 (못 읽거나 못 써도 화면은 그대로 돈다)
function jsonStore(key) {
  let value = null;
  const subs = new Set();
  const read = () => {
    if (value) return value;
    try { value = JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { value = {}; }
    if (typeof value !== 'object' || Array.isArray(value)) value = {};
    return value;
  };
  const write = (next) => {
    value = next;
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 저장 못 해도 됨 */ }
    for (const fn of subs) fn();
  };
  const subscribeStore = (fn) => { subs.add(fn); return () => subs.delete(fn); };
  return { read, write, subscribe: subscribeStore };
}

const seenStore = jsonStore('brain.seen');
// 읽음: 답 열쇠가 같으면 본 것. 이름이 바뀌어도 답이 같으면 다시 새 답이 되지 않는다
export function useSeen() {
  const seen = useSyncExternalStore(seenStore.subscribe, seenStore.read);
  const mark = useCallback((id, answer) => {
    if (!id || !answer) return;
    const cur = seenStore.read();
    if (cur[id] === answer) return;
    const next = { ...cur, [id]: answer };
    // 오래된 것은 300개만 남긴다
    const keys = Object.keys(next);
    if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete next[k];
    seenStore.write(next);
  }, []);
  return [seen, mark];
}

const draftStore = jsonStore('brain.draft');
// 패널 입력창 초안 — 작업 id에 묶여 패널이 바뀌어도 남는다
export function useDraft(id) {
  const all = useSyncExternalStore(draftStore.subscribe, draftStore.read);
  const set = useCallback((text) => {
    const cur = { ...draftStore.read() };
    if (text) cur[id] = text; else delete cur[id];
    draftStore.write(cur);
  }, [id]);
  return [all[id] ?? '', set];
}

// 새 답 가운데 아직 안 본 것
export const unseenAnswers = (attention, seen) => (attention ?? []).filter((x) => ANSWER_KINDS.has(x.kind) && !(x.answer && seen[x.task ?? x.key] === x.answer));
export const actionItems = (attention) => (attention ?? []).filter((x) => ACTION_KINDS.has(x.kind));
// 지금 일하는 작업 id (두뇌 세션이든 앱에서 연 바깥 세션이든) — 카드가 빛나는 기준
export const workingIds = (sessions) => new Set((sessions ?? []).filter((s) => ['작업중', '여는중'].includes(s.run?.state)).map((s) => s.id));
export const liveSessions = (sessions) => (sessions ?? [])
  .filter((s) => LIVE_STATES.includes(s.run?.state))
  .sort((a, b) => LIVE_STATES.indexOf(a.run.state) - LIVE_STATES.indexOf(b.run.state) || String(b.run.lastAt ?? '').localeCompare(String(a.run.lastAt ?? '')));
