// 바깥에서 도는 일 (두뇌가 띄우지 않은 작업): 다른 Claude Code 세션이 돌리는 영상 녹음·렌더 같은 것.
// 그 일이 app/external/<작업 id>.json 에 주기적으로 신호를 남기면, 화면은 두뇌 세션처럼 "작업 중"으로 보여 준다.
//   { "startedAt": "2026-10-31T11:40:00", "beat": "2026-10-31T11:52:10", "step": "GF94 녹음", "line": "…", "pid": 1234, "stop": "D:/…/work_gfbatch.stop",
//     "done": 120, "total": 800, "unit": "줄" }
// 진행률(선택): done·total·unit을 주면 화면이 %·빠르기·남은 시간을 계산한다. 일이 직접 "eta"(초)를 주면 그것을 쓴다.
// 끝나면 "finished": true를 쓰거나 파일을 지운다. 신호 도구: scripts/beat.mjs, ffmpeg는 scripts/ffprog.mjs.
// beat가 STALL_MS보다 오래되면 "멈춤 의심", STALE_MS보다 오래되면 끝난 것으로 본다.
// stop이 있으면 화면의 중지 버튼이 그 파일을 만든다(바깥 일이 스스로 멈춤).
import fs from 'node:fs';
import path from 'node:path';

export const STALE_MS = 10 * 60_000;
export const STALL_MS = 60_000;
const POLL_MS = 5_000;
const RATE_WINDOW = 5 * 60_000;   // 빠르기는 최근 5분 표본으로

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const load = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };

// 진행률: hist = [[시각, done], …] (오래된 것부터). 빠르기는 최근 창의 처음과 끝, 표본이 모자라면 시작부터 평균
export function progressOf(b, { now, beat, startedAt, hist = [] }) {
  const done = num(b.done), total = num(b.total);
  if (done == null) return null;
  const pct = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : null;
  const win = hist.filter(([t]) => now - t <= RATE_WINDOW);
  let rate = null;   // 단위/초
  if (win.length >= 2 && win.at(-1)[0] > win[0][0] && win.at(-1)[1] > win[0][1]) rate = (win.at(-1)[1] - win[0][1]) / ((win.at(-1)[0] - win[0][0]) / 1000);
  else if (beat > startedAt && done > 0) rate = done / ((beat - startedAt) / 1000);
  const eta = num(b.eta) ?? (rate > 0 && total > done ? (total - done) / rate : null);
  return { done, total, unit: b.unit ?? null, pct, rate, eta: eta == null ? null : Math.round(eta) };
}

export function readBeat(file, now = Date.now(), hist = []) {
  const b = load(file);
  if (!b) return null;
  const beat = Date.parse(b.beat);
  if (!Number.isFinite(beat) || now - beat > STALE_MS || b.finished) return null;
  const startedAt = Date.parse(b.startedAt) || beat;
  return {
    phase: '실행', external: true,
    startedAt, lastSignal: beat, stalled: now - beat > STALL_MS,
    step: b.step ?? null, lastText: b.line ?? null, tools: 0, pid: Number(b.pid) || null, stop: b.stop ?? null,
    progress: progressOf(b, { now, beat, startedAt, hist }),
  };
}

export function createExternal({ dir, emit = () => {}, poll = POLL_MS, now = () => Date.now() }) {
  const fileOf = (id) => path.join(dir, `${id}.json`);
  const seen = new Map();   // id → 마지막으로 알린 상태 (바뀔 때만 화면에 알린다)
  const hist = new Map();   // id → [[시각, done], …] 빠르기 계산용
  const sample = (id) => {
    const b = load(fileOf(id));
    const d = num(b?.done), t = Date.parse(b?.beat);
    if (d == null || !Number.isFinite(t)) return;
    const h = hist.get(id) ?? hist.set(id, []).get(id);
    if (h.length && h.at(-1)[0] === t) return;
    if (h.length && d < h.at(-1)[1]) h.length = 0;   // 처음부터 다시 시작한 일
    h.push([t, d]);
    while (h.length && now() - h[0][0] > RATE_WINDOW * 2) h.shift();
  };
  const read = (id) => { sample(id); return readBeat(fileOf(id), now(), hist.get(id) ?? []); };

  const scan = () => {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { /* 폴더 없음 = 바깥 일 없음 */ }
    const ids = new Set(names.map((n) => n.slice(0, -5)));
    for (const id of new Set([...ids, ...seen.keys()])) {
      const r = ids.has(id) ? read(id) : null;
      if (!r) hist.delete(id);
      // 진행률은 1% 단위로만 알린다 (화면이 너무 자주 다시 읽지 않게)
      const key = r ? `${r.phase}|${r.step}|${r.lastText}|${r.stalled}|${r.progress ? Math.floor(r.progress.pct ?? r.progress.done) : ''}` : '';
      if ((seen.get(id) ?? '') === key) continue;
      if (key) seen.set(id, key); else seen.delete(id);
      emit('runtime', { id, phase: r?.phase ?? null });
    }
  };
  const timer = poll ? setInterval(scan, poll) : null;
  timer?.unref?.();

  return {
    runtime: (id) => read(id),
    // 중지 요청: 바깥 일이 알려 준 멈춤 파일을 만든다 (지금 단계가 끝나면 스스로 멈춘다)
    stop: (id) => {
      const r = readBeat(fileOf(id));
      if (!r?.stop) return false;
      fs.writeFileSync(r.stop, `SYNAPSE BRAIN 중지 요청 ${new Date().toISOString()}\n`);
      return true;
    },
    sessions: () => [...seen.keys()].map((id) => ({ id, r: readBeat(fileOf(id)) })).filter((x) => x.r?.pid).map(({ id, r }) => ({ id, pid: r.pid, startedAt: r.startedAt })),
    scan,
    close: () => timer && clearInterval(timer),
  };
}
