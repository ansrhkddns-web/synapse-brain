// Claude 작업 기록 (비서실): 이 PC의 모든 Claude Code 세션(데스크톱 앱·터미널)을 작업 파일로 남기고 부서에 배정한다.
//   세션 하나 = 작업 하나 (W-…, tags: 바깥세션 · cc-<세션 id>). 두뇌가 띄운 세션은 이미 작업이 있으니 뺀다.
//   사람 말 → 실행중 + 진행 로그 "사람: …" / 턴 끝 → 검수 + 결과에 마지막 답 / 세션 종료 → 로그
//   배정: 세션을 연 폴더가 먼저, 못 가리면 만진 경로, 그래도 못 가리면 사람 말의 낱말(match의 낱말)로 맞춘다(activity.place·byText).
//   다 못 가리면 비정규직,
//   나중에 더 좁은 자리가 보이면 옮긴다(사람이 옮긴 작업은 그대로 — 태그 '자동배정'이 빠지면 손대지 않는다).
//   이름: 턴이 끝날 때 대화 기록의 세션 제목(사람이 붙인 제목 → 자동 제목)을 따른다. 사람이 화면에서 이름을 바꾸면 태그 '자동이름'이 빠지고 더는 따르지 않는다.
import { place, byText, makeRules } from './activity.mjs';
import fs from 'node:fs';
import { shortTitle } from './store.mjs';

export const TAG = '바깥세션';
const AUTO = '자동배정';
export const AUTO_NAME = '자동이름';
const FALLBACK = '비정규직';
const ccTag = (id) => `cc-${id}`;
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// 키·토큰처럼 보이는 긴 덩어리는 기록에 남기지 않는다
const redact = (s) => String(s ?? '').replace(/[A-Za-z0-9_\-+/=]{24,}/g, '(가림)');
// 시스템이 붙인 <태그>…</태그> 덩어리는 사람 말이 아니다
const human = (s) => String(s ?? '').replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/g, '').trim();

// 대화 기록의 세션 제목: 끝부분에서 마지막 custom-title(사람이 붙인 제목), 없으면 마지막 ai-title. 앞의 "- "는 뗀다
const TITLE_TAIL = 512 * 1024;
export function sessionTitle(file) {
  if (!file) return null;
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const n = Math.min(size, TITLE_TAIL);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
      text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  let custom = null, ai = null;
  for (const line of text.split('\n')) {
    if (!line.includes('-title"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'custom-title' && j.customTitle) custom = j.customTitle;
    else if (j.type === 'ai-title' && j.aiTitle) ai = j.aiTitle;
  }
  const t = String(custom ?? ai ?? '').replace(/^[-–\s]+/, '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 60) : null;
}

export function isTracked(t) { return Array.isArray(t?.tags) && t.tags.includes(TAG); }
// cc-<Claude 세션 id> · cx-<Codex 세션 id> (코덱스 기록은 lib/codex.mjs가 만든다 — 훅이 없어 멈추기·지시 잇기는 안 된다)
export function sessionOf(t) { return t?.tags?.find((x) => /^c[cx]-/.test(String(x)))?.slice(3) ?? null; }

export function createWorklog({ store }) {
  const bySession = new Map();   // Claude 세션 id → 작업 id
  const brainTasks = new Set();  // 두뇌가 띄운 세션 (훅이 x-brain-task로 알려 줌)
  let loaded = false;
  // force: 모르는 세션이면 다시 훑는다 (다른 곳에서 만든 기록 — scripts/worklog-backfill.mjs)
  const load = (force = false) => {
    if (loaded && !force) return;
    for (const t of store.listTasks()) { const s = sessionOf(t); if (s) bySession.set(s, t.id); }
    loaded = true;
  };

  const route = (cwd, paths = [], text = '') => {
    const rules = makeRules({ depts: store.depts(), units: store.units(), processes: store.processes() });
    let w = place(rules, cwd, paths);
    if (!w.dept) w = byText(rules, text);
    return w.dept ? { dept: w.dept, unit: w.unit } : { dept: FALLBACK, unit: null };
  };

  async function open(ev, s, text) {
    const where = route(s?.cwd ?? ev.cwd, s?.paths, text);
    const id = await store.createTask({
      dept: where.dept, unit: where.unit, status: '실행중',
      title: sessionTitle(ev.transcript_path ?? s?.transcript) ?? clip(shortTitle(redact(text)), 60),
      instruction: `${redact(text).slice(0, 2000)}\n\n> Claude Code 세션 \`${ev.session_id}\` · 작업 폴더 \`${s?.cwd ?? ev.cwd ?? '?'}\` — 비서실 작업 기록이 자동으로 만든 기록이다.`,
      tags: [TAG, AUTO, AUTO_NAME, ccTag(ev.session_id)],
    });
    bySession.set(ev.session_id, id);
    await store.appendLog(id, `배정 → ${where.dept}${where.unit ? ` / ${where.unit}` : ''}`);
    return id;
  }

  // 더 좁은 자리가 보이면 옮긴다 (자동배정인 동안만)
  async function reroute(id, s) {
    const t = store.readTask(id).data;
    if (!t.tags?.includes(AUTO)) return;
    const w = route(s?.cwd ?? null, s?.paths, t.title);
    const better = (w.dept !== t.dept && (t.dept === FALLBACK || w.dept !== FALLBACK)) || (w.dept === t.dept && w.unit && w.unit !== t.unit);
    if (!better) return;
    await store.patchTask(id, { dept: w.dept, unit: w.unit ?? null });
    await store.appendLog(id, `다시 배정 → ${w.dept}${w.unit ? ` / ${w.unit}` : ''} (만진 경로 기준)`);
  }

  // 세션 제목을 따른다 (자동이름인 동안만)
  async function rename(id, ev, s) {
    const t = store.readTask(id).data;
    if (!t.tags?.includes(AUTO_NAME)) return;
    const name = sessionTitle(ev.transcript_path ?? s?.transcript);
    if (!name || name === t.title) return;
    await store.renameTask(id, name, '세션 제목으로');
  }

  // 훅 사건 하나 (hooks.handle 뒤에) — s = hooks.get(session_id)
  // 같은 세션의 사건은 한 줄로 처리한다 — 첫 말 두 개가 겹쳐 작업이 두 개 생기거나, 늦은 Stop이 앞 사건을 덮지 않게
  const lanes = new Map();
  function track(ev, s, opts = {}) {
    const sid = ev?.session_id;
    if (!sid || typeof sid !== 'string') return Promise.resolve(null);
    const run = (lanes.get(sid) ?? Promise.resolve()).then(() => trackOne(ev, s, opts));
    const tail = run.catch(() => {});
    lanes.set(sid, tail);
    tail.then(() => { if (lanes.get(sid) === tail) lanes.delete(sid); });
    return run;
  }

  // blocked: 훅이 Stop에 decision:block을 돌려줘 턴이 끝나지 않고 관제 화면 지시로 이어 감
  async function trackOne(ev, s, { brainTask = null, blocked = false } = {}) {
    const sid = ev.session_id;
    if (brainTask) { brainTasks.add(sid); return null; }
    if (brainTasks.has(sid)) return null;
    load();
    let id = bySession.get(sid) ?? null;
    if (!id && ev.hook_event_name === 'UserPromptSubmit') { load(true); id = bySession.get(sid) ?? null; }
    if (id) { try { store.readTask(id); } catch { bySession.delete(sid); id = null; } }

    switch (ev.hook_event_name) {
      case 'UserPromptSubmit': {
        const text = human(ev.prompt);
        if (!text) return id;
        if (!id) return open(ev, s, text);
        const t = store.readTask(id).data;
        if (t.status !== '실행중') await store.patchTask(id, { status: '실행중' });
        await store.appendLog(id, `사람: ${clip(redact(text), 140)}${['완료', '취소'].includes(t.status) ? ` (${t.status}에서 다시 엶)` : ''}`);
        return id;
      }
      case 'Stop': {
        if (!id) return null;
        await reroute(id, s);
        await rename(id, ev, s);
        if (blocked) {
          // 턴이 끝나지 않았다 — 검수로 넘기지 않는다
          if (store.readTask(id).data.status !== '실행중') await store.patchTask(id, { status: '실행중' });
          await store.appendLog(id, '관제 화면 지시를 받아 턴을 이어 감');
          return id;
        }
        // 사람이 이미 완료·취소로 판정한 뒤 늦게 온 턴 끝은 상태를 되돌리지 않는다 (다시 말하면 UserPromptSubmit이 다시 연다)
        const now = store.readTask(id).data.status;
        if (now === '완료' || now === '취소') { await store.appendLog(id, `턴 끝 (${now} 뒤 — 상태 그대로)`); return id; }
        const last = clip(redact(human(ev.last_assistant_message)), 700);
        await store.setResult(id, `${last || '(마지막 답 없음)'}\n\n> 턴이 끝난 때의 마지막 답. 이어서 일하면 다시 실행중이 된다.`, '검수');
        await store.appendLog(id, s?.lastAnswer ? `턴 끝 · 답 ${s.lastAnswer.slice(-8)}` : '턴 끝');
        return id;
      }
      case 'SessionEnd':
        if (id) await store.appendLog(id, `세션 종료${ev.reason ? ` (${ev.reason})` : ''}`);
        return id;
      case 'PreToolUse': {
        // 사람 말 없이 시작된 턴(백그라운드 작업 알림 등)도 도구를 쓰면 다시 일하는 중이다
        if (!id) return null;
        const st = store.readTask(id).data.status;
        if (st === '검수') { await store.patchTask(id, { status: '실행중' }); await store.appendLog(id, '다시 일하는 중 (사람 말 없이 시작된 턴)'); }
        return id;
      }
      default:
        return id;
    }
  }

  return { track, taskOf: (sid) => { load(); return bySession.get(sid) ?? null; } };
}
