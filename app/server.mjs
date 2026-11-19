// 두뇌 서버: 이 PC(127.0.0.1)에서만 받는다.
//   node server.mjs [--port 4747] [--vault ../vault]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { createStore, StoreError, stamp } from './lib/store.mjs';
import { createRunner } from './lib/runner.mjs';
import { createScheduler } from './lib/scheduler.mjs';
import { parseSchedule, nextFor } from './lib/schedule.mjs';
import { buildIndex, watchVault } from './lib/index.mjs';
import { buildTimeline } from './lib/timeline.mjs';
import { extDoc, isExtId, linkify } from './lib/synapse.mjs';
import { createAsk } from './lib/ask.mjs';
import { createDistill } from './lib/distill.mjs';
import { memoryDays } from './lib/memlog.mjs';
import { createMonitor } from './lib/monitor.mjs';
import { createExternal } from './lib/external.mjs';
import { createActivity } from './lib/activity.mjs';
import { createCodexLog } from './lib/codex.mjs';
import { createHooks } from './lib/hooks.mjs';
import { createWorklog, isTracked, sessionOf, AUTO_NAME } from './lib/worklog.mjs';
import { createPipeline } from './lib/pipeline.mjs';
import { verify } from './lib/checks.mjs';
import { createTokens } from './lib/tokens.mjs';
import { createTaxCal } from './lib/taxcal.mjs';
import { createNotifier, NOTIFY_FILE } from './lib/notify.mjs';
import { createSessions, chipText, answerKey, resultOf } from './lib/sessions.mjs';
import * as transcript from './lib/transcript.mjs';
import { createToday, askInstruction } from './lib/today.mjs';
import { rankMemory, readMarks, writeMark } from './lib/memrank.mjs';
import { createLearn, readLessons, addLesson, setLessonState, listSkills, readState as learnState, skillInstruction, KINDS as LEARN_KINDS, SKILL_OPTIONS } from './lib/learn.mjs';
import { toolLabel, argOf } from './lib/ko.mjs';
import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import { checkVault, loadVault, TASK_STATUS, linkTarget } from './lib/vault.mjs';

// 내 차례 가운데 사람이 무언가 해야 하는 것 (새 답·검수는 읽을 것이라 따로 센다)
const ACTION_KINDS = new Set(['결정', '권한', '입력대기', '승인', '실패', '멈춤의심']);

const HOST = '127.0.0.1';
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web', 'dist');
// 바깥에서 도는 일이 신호를 남기는 곳 (lib/external.mjs)
const EXTERNAL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'external');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.json': 'application/json',
};

export function createServer({ root, runner: runnerOpts = {}, scheduler: schedulerOpts = {}, pipeline: pipelineOpts = {}, externalDir = EXTERNAL, port = 4747, notify = false } = {}) {
  // 역링크·검색 색인은 파일이 바뀐 뒤 처음 쓸 때 다시 만든다
  let index = null;
  const getIndex = () => (index ??= buildIndex(root, store.files()));
  const store = createStore(root, { onWrite: () => { index = null; } });
  const clients = new Set();
  const emit = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  const runner = createRunner({ store, emit, ...runnerOpts });
  const external = createExternal({ dir: externalDir, emit });
  const scheduler = createScheduler({ store, runner, emit, ...schedulerOpts });
  // 공정 실행기: 공정 문서의 단계를 하나씩 돌리고 단계 사이에 승인을 받는다
  const pipeline = createPipeline({ store, runner, emit, externalDir, ...pipelineOpts });
  const stopWatch = watchVault(root, (changed) => {
    store.invalidate();
    index = null;
    emit('vault', { changed });
  });

  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn });

  const taskView = (t) => {
    const rule = t.status === '대기예약' ? parseSchedule(t.schedule) : null;
    const next = rule ? nextFor(t, new Date()) : null;
    // 두뇌 세션이 없으면 바깥에서 도는 일의 신호를 본다
    const rt = runner.runtime(t.id);
    const ext = rt.phase == null ? external.runtime(t.id) : null;
    return { ...t, runtime: ext ? { ...rt, ...ext } : rt, next: next ? stamp(next) : null, repeat: rule?.kind === 'repeat' };
  };

  // 기억 쌓기 (주인 말·검수 판정). 기록이 실패해도 본래 일은 그대로 끝낸다
  const remember = (kind, text) => store.appendMemory(kind, text).catch((e) => console.error('기억 기록 실패:', e.message));

  route('GET', '/api/state', () => {
    const tasks = store.listTasks().map(taskView);
    const decisions = store.listDecisions();
    return {
      depts: store.depts().map(({ rules, file, ...d }) => d),
      units: store.units().map(({ rules, ...u }) => u),
      // 공정마다 문서 대조(산출물이 실제로 있는지) 결과를 붙인다
      processes: store.processes().map((p) => ({ ...p, verify: verify(p) })),
      kpi: store.kpi(),
      tasks,
      pending: decisions.filter((d) => d.status === '대기'),
      // 확인 필요 = 내 차례 가운데 행동이 필요한 것 (결정·권한·입력대기·승인·실패·멈춤의심). 새 답은 따로
      needsMe: attention().filter((x) => ACTION_KINDS.has(x.kind)).length,
      doneToday: doneToday(),
      pipeline: pipeline.view(),
      // 결재함 아래 "내린 결정" 기록 (최근 20)
      decided: decisions.filter((d) => d.status === '결정됨').sort((a, b) => b.id.localeCompare(a.id)).slice(0, 20)
        .map(({ id, title, task, dept, kind, created, options, choice, note }) => ({ id, title, task, dept, kind, created, choice, answer: options?.[choice - 1] ?? null, note: note ?? null })),
      reports: store.listReports().sort((a, b) => b.id.localeCompare(a.id)).slice(0, 20),
      journals: store.listJournals().sort((a, b) => b.name.localeCompare(a.name)).slice(0, 14),
    };
  });

  // 문서 하나. 참고 문서(ext:·dir:)는 부서 작업 폴더에서 읽기만 한다.
  // refs: 본문 `경로` 코드 가운데 지도의 점으로 이어지는 것 (화면이 눌러서 열 수 있게)
  route('GET', '/api/docs/([^/]+)', (_req, [name]) => {
    const syn = getIndex().syn();
    if (isExtId(name)) {
      const doc = extDoc(syn, name);
      if (!doc) throw new StoreError(`${name} 없음`, 404);
      return { ...doc, backlinks: [] };
    }
    const doc = store.findDoc(name);
    return { ...doc, refs: linkify(syn, doc.body).refs, backlinks: getIndex().backlinks(name) };
  });

  route('PUT', '/api/docs/([^/]+)', async (req, [name]) => {
    const { raw } = await req.json();
    if (typeof raw !== 'string') throw new StoreError('raw가 필요함');
    if (isExtId(name)) throw new StoreError('참고 문서는 읽기 전용 — 원본 폴더에서 고친다', 403);
    const { rel } = store.findDoc(name);
    await store.writeRaw(rel, raw, () => checkVault({ root, files: store.files() }).errors);
    emit('vault', { changed: [rel] });
    return { ok: true };
  });

  route('GET', '/api/tasks/([^/]+)', (_req, [id]) => {
    const { data, body } = store.readTask(id);
    return { ...taskView(data), body, backlinks: getIndex().backlinks(id) };
  });

  // 대화: 두뇌 세션은 SDK 기록, 바깥 세션(태그 cc-)은 Claude Code 대화 기록 파일. 모양은 같다
  //   tools: 도구 원이름 목록(예전 모양 그대로) · toolDetails: [{name, label(한국어), arg}]
  // 대화 기록 파서의 도구 객체 → 예전 모양(원이름 목록) + toolDetails
  const withNames = (m) => ({ ...m, tools: m.tools.map((t) => t.name), toolDetails: m.tools });
  const outsideRead = (sid) => (sid ? transcript.read(sid, { transcriptPath: hooks.get(sid)?.transcript ?? null }) : null);
  const brainMessages = async (data) => {
    if (!data.session) return [];
    try { return await getSessionMessages(data.session, { dir: store.dept(data.dept).workdir }); } catch { return []; }
  };
  route('GET', '/api/tasks/([^/]+)/messages', async (_req, [id]) => {
    if (id.startsWith('cc:')) return (outsideRead(id.slice(3))?.messages ?? []).map(withNames);
    const { data } = store.readTask(id);
    if (isTracked(data)) return (outsideRead(sessionOf(data))?.messages ?? []).map(withNames);
    const msgs = await brainMessages(data);
    return msgs.flatMap((m) => {
      const content = m.message?.content;
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      const texts = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const uses = blocks.filter((b) => b.type === 'tool_use');
      if (!texts && !uses.length) return [];
      return [{ uuid: m.uuid, role: m.type, text: texts, tools: uses.map((b) => b.name), toolDetails: uses.map((b) => ({ name: b.name, label: toolLabel(b.name, 1), arg: argOf(b.input) })), at: m.timestamp ?? null }];
    });
  });

  // 결과 증거: 마지막 답 · 게시한 아티팩트 · 성공한 쓰기 파일 · 보고서 · 명령 수. 읽은 범위가 일부면 partial
  route('GET', '/api/tasks/([^/]+)/evidence', async (_req, [id]) => {
    let r = null; let source = '없음'; let data = null;
    if (id.startsWith('cc:')) { r = outsideRead(id.slice(3)); source = '바깥'; }
    else {
      data = store.readTask(id).data;
      if (isTracked(data)) { r = outsideRead(sessionOf(data)); source = '바깥'; }
      else if (data.session) {
        const msgs = await brainMessages(data);
        r = { ...transcript.parse(msgs.map((m) => JSON.stringify({ ...m, type: m.type, timestamp: m.timestamp ?? null })).join('\n')), folded: 0 };
        source = '두뇌';
      }
    }
    const reports = data ? store.listReports().filter((x) => [].concat(x.task ?? []).some((v) => String(v).includes(id))).map((x) => ({ id: x.id, title: x.title, created: x.created })) : [];
    const e = r?.evidence ?? { lastText: null, artifacts: [], files: [], commands: 0, failed: 0, tools: 0, turns: 0 };
    const body = data ? store.readTask(id).body : '';
    return { source, found: !!r, lastText: e.lastText, lastAnswer: data ? answerKey(body) : null, artifacts: e.artifacts, files: e.files.slice(0, 40), commands: e.commands, failed: e.failed ?? 0, tools: e.tools, turns: e.turns, reports, result: resultOf(body), range: { folded: r?.folded ?? 0, partial: (r?.folded ?? 0) > 0 } };
  });

  route('POST', '/api/tasks', async (req) => {
    const { dept, unit = null, title, instruction, start = true, schedule = null } = await req.json();
    // 예약이 있으면 대기예약으로 두고, 때가 되면 예약 실행기가 돌린다
    if (schedule != null && !parseSchedule(schedule)) {
      throw new StoreError('예약은 2026-10-31T07:00 또는 "매일 07:30"·"평일 09:00"·"주말 10:00"·"토요일 08:00" 형식');
    }
    const id = await store.createTask({ dept, unit, title, instruction, ...(schedule ? { status: '대기예약', schedule: schedule.trim() } : {}) });
    if (start && !schedule) runner.start(id);
    await remember('주인말', `**지시** [[${id}]] ${dept}${unit ? ` / ${unit}` : ''}${schedule ? ` · 예약 ${schedule.trim()}` : ''} — ${instruction ?? title ?? ''}`);
    return { id };
  });

  route('POST', '/api/units', async (req) => {
    const { dept, name, summary } = await req.json();
    return { id: await store.createUnit({ dept, name, summary }) };
  });
  // 하위 항목 명령 (문서의 commands): 화면 버튼 → PowerShell로 돌리고 출력을 돌려준다. 문서에 적힌 명령만, 90초 제한, 낮은 우선순위
  route('POST', '/api/units/command', async (req) => {
    const { unit, name } = await req.json();
    const u = store.units().find((x) => x.id === unit);
    const c = u?.commands?.[name];
    const run = typeof c === 'string' ? c : c?.run;
    if (!run) throw new StoreError('그 하위 항목에 없는 명령', 404);
    const out = await runCommand(run, { cwd: u.workdir && fs.existsSync(u.workdir) ? u.workdir : undefined });
    return { unit, name, ...out };
  });

  route('POST', '/api/tasks/([^/]+)/run', async (_req, [id]) => {
    const started = await scheduler.runNow(id);
    await remember('주인말', `**지금 실행** [[${id}]]${started !== id ? ` → [[${started}]]` : ''}`);
    return { started };
  });

  route('POST', '/api/tasks/([^/]+)/messages', async (req, [id]) => {
    const { text } = await req.json();
    if (!text?.trim()) throw new StoreError('text가 비었음');
    // 바깥 세션 기록이면 그 Claude Code 세션에 훅으로 지시를 보낸다
    const t = store.readTask(id).data;
    if (isTracked(t)) {
      const r = hooks.control(sessionOf(t), { message: text.trim() });
      if (!r.ok) throw new StoreError(r.error, 409);
      await store.appendLog(id, `관제 화면 지시 → ${r.when}`);
      await remember('주인말', `**이어서** [[${id}]] — ${text.trim()}`);
      return { state: 'hook', when: r.when };
    }
    const state = await runner.send(id, text.trim());
    await remember('주인말', `**이어서** [[${id}]] — ${text.trim()}`);
    return { state };
  });

  route('POST', '/api/tasks/([^/]+)/status', async (req, [id]) => {
    const { status, note = null } = await req.json();
    return setStatus(id, status, note);
  });
  async function setStatus(id, status, note = null) {
    if (!TASK_STATUS.includes(status)) throw new StoreError(`status는 ${TASK_STATUS.join('·')}`);
    const before = store.readTask(id).data;
    if (['완료', '취소'].includes(status)) runner.stop(id);
    await store.patchTask(id, { status });
    await store.appendLog(id, `사용자가 상태 변경 → ${status}${note ? ` — ${note}` : ''}`);
    // 검수 판정: 완료 확인 · 취소 · 끝난 일을 다시 열기
    const why = note ? ` — ${note}` : '';
    if (status === '완료') await remember('검수', `**완료** [[${id}]] ${before.title}${before.status === '검수' ? ' (검수 → 확인)' : ` (${before.status}에서)`}${why}`);
    else if (status === '취소') await remember('검수', `**취소** [[${id}]] ${before.title}${why}`);
    else if (['완료', '취소', '검수'].includes(before.status) && before.status !== status) await remember('검수', `**다시 열기** [[${id}]] ${before.title} (${before.status} → ${status})${why}`);
    emit('task', { id });
    return { ok: true };
  }

  // 판정: 결과를 보고 확인 완료 / 다시(이유) — 어느 답을 보고 판정했는지(answer)를 맞춘다
  //   답이 바뀌었으면 409, 같은 판정을 두 번 보내면 처음 결과, 공정 단계 작업은 409(공정 버튼으로)
  const reviewed = new Map();
  route('POST', '/api/tasks/([^/]+)/review', async (req, [id]) => {
    const { verdict, answer = null, note = null } = await req.json();
    if (!['완료', '다시'].includes(verdict)) throw new StoreError("verdict는 '완료' 또는 '다시'");
    const key = `${id}|${answer}|${verdict}`;
    if (reviewed.has(key)) return reviewed.get(key);
    const { data, body } = store.readTask(id);
    const current = answerKey(body);
    if (answer && current && answer !== current) throw Object.assign(new StoreError('새 답이 왔어요 — 다시 보고 판정하세요', 409), { current });
    const proc = store.processes().find((p) => linkTarget(p.run) === id);
    if (proc) throw new StoreError(`공정 단계예요 — 공정 「${proc.title ?? proc.id}」의 승인·다시 돌리기로 판정하세요`, 409);
    const tag = answer ? ` · 답 ${answer.slice(-8)}` : '';
    let out;
    if (verdict === '완료') {
      await store.appendLog(id, `판정 완료${tag}`);
      await setStatus(id, '완료', note);
      out = { ok: true, status: '완료' };
    } else {
      if (!String(note ?? '').trim()) throw new StoreError('다시 시킬 이유를 한 줄 적어 주세요');
      const text = `[검수] 다시: ${note.trim()}`;
      let how;
      if (isTracked(data)) {
        const r = hooks.control(sessionOf(data), { message: text });
        if (!r.ok) throw new StoreError('세션이 끝났거나 훅이 연결되지 않았어요 — 앱에서 그 세션을 이어서 열어 주세요', 409);
        how = r.when;
      } else {
        await runner.send(id, text);
        how = '세션이 바로 이어서 합니다';
      }
      await store.appendLog(id, `사용자가 다시 시킴 — ${note.trim()}${tag}`);
      if (store.readTask(id).data.status !== '실행중') await store.patchTask(id, { status: '실행중' });
      await remember('검수', `**다시 열기** [[${id}]] ${data.title} (${data.status} → 실행중) — ${note.trim()}`);
      emit('task', { id });
      out = { ok: true, status: '실행중', when: how };
    }
    reviewed.set(key, out);
    if (reviewed.size > 500) reviewed.delete(reviewed.keys().next().value);
    return out;
  });

  route('POST', '/api/tasks/([^/]+)/title', async (req, [id]) => {
    const { title } = await req.json();
    const r = await store.renameTask(id, title);
    // 사람이 이름을 정하면 바깥 세션 기록도 더는 세션 제목을 따르지 않는다
    const tags = store.readTask(id).data.tags ?? [];
    if (tags.includes(AUTO_NAME)) await store.patchTask(id, { tags: tags.filter((x) => x !== AUTO_NAME) });
    if (r.changed) {
      await remember('주인말', `**이름 변경** [[${id}]] ${r.before} → ${r.title}`);
      emit('task', { id });
    }
    return { ok: true, ...r };
  });

  route('POST', '/api/tasks/([^/]+)/stop', (_req, [id]) => {
    if (runner.stop(id)) return { stopped: true, how: '두뇌' };
    if (external.stop(id)) return { stopped: true, how: '신호' };
    const sid = id.startsWith('cc:') ? id.slice(3) : (() => { try { const d = store.readTask(id).data; return isTracked(d) ? sessionOf(d) : null; } catch { return null; } })();
    if (sid && hooks.control(sid, { stop: true }).ok) return { stopped: true, how: '예약', when: '지금 도구가 끝나면 멈춥니다' };
    return { stopped: false };
  });

  // 공정 실행기 — run: 지금 단계 실행 · approve {note?}: 승인하고 다음으로 · retry {note?}: 같은 단계 다시 ·
  // next: 사람 단계를 했으니 다음으로 · stop: 멈춤(위치는 그대로) · item {item, go?}: 새 작업물로 처음 단계부터
  const P = '/api/processes/([^/]+)';
  const body = async (req) => (/application\/json/.test(req.headers['content-type'] ?? '') ? req.json() : {});
  route('POST', `${P}/run`, (_req, [id]) => pipeline.run(id));
  route('POST', `${P}/approve`, async (req, [id]) => pipeline.approve(id, (await body(req)).note));
  route('POST', `${P}/retry`, async (req, [id]) => pipeline.retry(id, (await body(req)).note));
  route('POST', `${P}/next`, (_req, [id]) => pipeline.advance(id));
  route('POST', `${P}/stop`, (_req, [id]) => pipeline.stop(id));
  route('POST', `${P}/stage`, async (req, [id]) => pipeline.setStage(id, (await body(req)).stage));
  route('POST', `${P}/item`, async (req, [id]) => { const b = await body(req); return pipeline.startItem(id, b.item, { go: !!b.go, slug: b.slug }); });

  route('GET', '/api/decisions/([^/]+)', (_req, [id]) => {
    const { data, body } = store.readDecision(id);
    return { ...data, body };
  });

  route('POST', '/api/decisions/([^/]+)', async (req, [id]) => {
    const { choice, note } = await req.json();
    const d = store.readDecision(id).data;
    const r = d.kind === '기억' ? await answerCard(id, Number(choice), note) : d.kind === '스킬' ? await answerSkill(id, Number(choice), note) : await runner.answer(id, Number(choice), note);
    await remember('주인말', `**${d.kind === '권한' ? '권한' : '결정'}** [[${id}]] ${d.title} → ${choice}번 “${d.options?.[Number(choice) - 1] ?? ''}”${note ? ` · 메모: ${note}` : ''} (${d.task ?? ''})`);
    return r;
  });

  route('GET', '/api/search', (req) => getIndex().search(req.url.searchParams.get('q') ?? ''));
  route('GET', '/api/backlinks/([^/]+)', (_req, [name]) => getIndex().backlinks(name));
  route('GET', '/api/graph', () => getIndex().graph());

  // ── 기억 카드: 그날 기록에서 규칙 후보 뽑기 → 결재(kind 기억) → 승인하면 카드 → 세션 지시문에 붙음
  const distill = createDistill({ root, ...(runnerOpts.queryFn ? { queryFn: runnerOpts.queryFn } : {}) });
  const CARD_OPTIONS = ['기억한다', '고쳐서 기억한다 (메모에 고친 문장)', '버린다'];
  // 기억 기록(주인말·검수판정·세션지시)을 항목으로: 날짜별 + 링크한 문서의 이름·상태 (name이 있으면 그 파일 하나)
  route('GET', '/api/memory', (req) => {
    const q = req.url.searchParams;
    const days = memoryDays(store.files(), { days: Math.min(Number(q.get('days')) || 14, 120), name: q.get('name') || null });
    const nodes = new Map(getIndex().graph().nodes.map((n) => [n.id, n]));
    const refs = {};
    for (const d of days) for (const e of d.entries) for (const id of [e.task, ...e.links]) {
      const n = id && nodes.get(id);
      if (n && !refs[id]) refs[id] = { title: n.title, type: n.type, status: n.status ?? null, dept: n.dept ?? null };
    }
    return { days, refs };
  });
  // 기억 정리: 문서마다 층(지금·기준·결과·흔적) · 출처(어떻게 쌓였나) · 무게(0~100, 까닭 포함). 사람이 고친 분류는 기억/분류.json
  route('GET', '/api/memory/rank', () => rankMemory(store.files(), { marks: readMarks(root) }));
  route('POST', '/api/memory/rank/(.+)', async (req, [id]) => {
    const { mark = null } = await req.json();
    if (mark && !['핵심', '흔적'].includes(mark)) throw new StoreError('mark는 핵심·흔적·null');
    writeMark(root, id, mark);
    await remember('주인말', `**기억 분류** ${/^(부서|하위):|^CLAUDE$/.test(id) ? id : `[[${id}]]`} → ${mark ?? '원래대로'}`);
    emit('task', { id: null });
    return rankMemory(store.files(), { marks: readMarks(root) });
  });
  route('GET', '/api/memory/cards', () => store.listCards());
  route('POST', '/api/memory/cards/([^/]+)', async (req, [id]) => {
    const { rule = null, status = null } = await req.json();
    return store.patchCard(id, { rule, status });
  });
  // Claude 앱 세션(바깥 세션)에서 사람이 한 말도 재료로: 그날 말한 것만 세션별로 모아 기억/세션지시-<날>.md에 다시 쓴다
  const clipWords = (t, n) => { const x = String(t ?? '').replace(/[A-Za-z0-9_\-+/=]{24,}/g, '(가림)').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
  function sessionWords(date) {
    const rel = `기억/세션지시-${date}.md`;
    const parts = [];
    for (const t of store.listTasks().filter(isTracked)) {
      const said = (outsideRead(sessionOf(t))?.messages ?? [])
        .filter((m) => m.role === 'user' && m.at && stamp(new Date(m.at)).slice(0, 10) === date && m.text.trim());
      if (!said.length) continue;
      parts.push(`### [[${t.id}]] ${t.title} (${t.dept}${t.unit ? ` / ${t.unit}` : ''})`, '',
        ...said.map((m) => `- ${stamp(new Date(m.at)).slice(11, 16)} ${clipWords(m.text, 500)}`), '');
    }
    const file = path.join(root, rel);
    if (!parts.length) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      '---', 'type: 세션지시', `date: ${date}`, '---',
      `# 세션 지시 · ${date}`, '',
      '사람이 Claude 앱 세션(바깥 세션)에서 한 말. 후보를 뽑을 때마다 서버가 대화 기록에서 다시 모은다 — 기억 카드의 재료.', '',
      '## 기록', '', ...parts,
    ].join('\n'));
    return rel;
  }
  route('POST', '/api/memory/propose', async (req) => {
    const { date = stamp(new Date()).slice(0, 10) } = await req.json().catch(() => ({}));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new StoreError('date는 2026-10-30 형식');
    sessionWords(date);
    const files = [`기억/주인말-${date}.md`, `기억/검수-${date}.md`, `기억/세션지시-${date}.md`].filter((f) => fs.existsSync(path.join(root, f)));
    if (!files.length) throw new StoreError(`${date}에 쌓인 주인 말·검수 판정·세션 지시가 없음`, 404);
    const cards = store.listCards().filter((c) => c.status === '사용').map((c) => c.rule);
    const depts = store.depts();
    const scopes = depts.flatMap((d) => [d.name, ...store.units(d.name).map((u) => `${d.name}/${u.name}`)]);
    const found = (await distill({ date, files, cards, scopes }))
      .map((c) => ({ ...c, dept: depts.some((d) => d.name === c.dept) ? c.dept : null }))
      .map((c) => ({ ...c, unit: c.dept && store.units(c.dept).some((u) => u.name === c.unit) ? c.unit : null }));
    if (!found.length) return { count: 0, task: null };
    const task = await store.createTask({
      dept: '비서실', title: `기억 카드 후보 · ${date}`, status: '결정대기',
      instruction: `${date} 주인 말·검수 판정에서 뽑은 규칙 후보 ${found.length}개를 결재한다. (서버가 만든 작업 — 세션 없음)`,
    });
    for (const c of found) {
      const scope = c.unit ? `${c.dept} / ${c.unit}` : c.dept ?? '모든 부서';
      await store.createDecision({
        task, kind: '기억', title: `기억할까요? — ${c.rule}`, options: CARD_OPTIONS, recommended: 1,
        background: [
          `**규칙**: ${c.rule}`, `**적용**: ${scope}`, `**근거 기록**: ${c.sources.map((s) => `[[${s}]]`).join(' ') || '(없음)'}`,
          '', c.why || '', '', '```card', JSON.stringify(c), '```',
        ].join('\n'),
      });
    }
    emit('task', { id: task });
    return { count: found.length, task };
  });

  // ── 배움 → 스킬 (lib/learn.mjs): 일하다 알게 된 것을 모으고(세션·저녁 추출·사람), 모이면 "스킬로 만들까요?" 결재 → 스킬관리부가 SKILL.md를 쓴다
  const learn = createLearn({ root, ...(runnerOpts.queryFn ? { queryFn: runnerOpts.queryFn } : {}), ...(runnerOpts.skillsDir ? { skillsDir: runnerOpts.skillsDir } : {}) });
  const learnScopes = () => store.depts().flatMap((d) => [d.name, ...store.units(d.name).map((u) => `${d.name}/${u.name}`)]);
  const pendingSkills = () => store.listDecisions().filter((x) => x.kind === '스킬' && x.status === '대기');
  route('GET', '/api/learn', () => ({
    lessons: readLessons(root, { days: 90 }), runs: learnState(root).runs, busy: learn.busy(),
    skills: listSkills(runnerOpts.skillsDir), pending: pendingSkills().map((x) => ({ id: x.id, title: x.title, task: linkTarget(x.task) })),
  }));
  route('POST', '/api/learn', async (req) => {
    const { text, kind = '방법', dept = null, unit = null, skill = null } = await req.json();
    const id = addLesson(root, { text, kind, dept, unit, skill, by: '사람' });
    await remember('주인말', `**배움** ${id} ${String(text).trim().slice(0, 120)}`);
    emit('task', { id: null });
    return { id };
  });
  route('POST', '/api/learn/extract', async (req) => {
    const { date } = await req.json().catch(() => ({}));
    sessionWords(date ?? stamp(new Date()).slice(0, 10));
    const r = await learn.extract({ date: date ?? undefined, scopes: learnScopes() });
    emit('task', { id: null });
    return r;
  });
  route('POST', '/api/learn/propose', () => proposeSkills());
  route('POST', '/api/learn/state/([^/]+)', async (req, [id]) => {
    const { status } = await req.json();
    if (!['모음', '버림'].includes(status)) throw new StoreError('status는 모음·버림');
    setLessonState(root, [id], { status });
    emit('task', { id: null });
    return { ok: true };
  });
  async function proposeSkills() {
    const { proposals, open } = await learn.propose();
    if (!proposals.length) return { count: 0, task: null, open: open.length };
    const date = stamp(new Date()).slice(0, 10);
    const task = await store.createTask({
      dept: '스킬관리부', title: `스킬 제안 · ${date}`, status: '결정대기',
      instruction: `모아 둔 배움 ${open.length}개에서 스킬 제안 ${proposals.length}개를 뽑았다. 고르면 스킬관리부 작업이 SKILL.md를 쓴다. (서버가 만든 작업 — 세션 없음)`,
    });
    const byId = new Map(open.map((l) => [l.id, l]));
    for (const p of proposals) {
      const did = await store.createDecision({
        task, kind: '스킬', title: `스킬로 만들까요? — ${p.action === '스킬 고침' ? `${p.name} 고침` : `${p.title} (${p.name})`}`, options: SKILL_OPTIONS, recommended: 1,
        background: [
          `**${p.action}**: \`${p.name}\` — ${p.title}`, '', p.why, '',
          `**근거 배움 ${p.lessons.length}개**`, ...p.lessons.map((id) => `- ${id} [${byId.get(id)?.kind ?? ''}] ${byId.get(id)?.text ?? ''}`),
          ...(p.outline.length ? ['', '**들어갈 내용**', ...p.outline.map((o) => `- ${o}`)] : []),
          '', '```skill', JSON.stringify(p), '```',
        ].join('\n'),
      });
      setLessonState(root, p.lessons, { status: '제안', decision: did, skill: p.name });
    }
    emit('task', { id: task });
    return { count: proposals.length, task, open: open.length };
  }
  // 스킬 제안 결재: 만든다/고쳐서 → 스킬관리부 작업을 만들어 바로 시작, 버린다 → 그 배움은 버림
  async function answerSkill(id, choice, note) {
    const { body } = store.readDecision(id);
    if (choice === 2 && !note?.trim()) throw new StoreError('고쳐서 만들려면 메모에 고칠 점을 적어 주세요');
    let p = null;
    try { p = JSON.parse(body.match(/```skill\s*([\s\S]*?)```/)?.[1] ?? 'null'); } catch { p = null; }
    const { taskId } = await store.answerDecision(id, choice, note);
    if (p && choice !== 3) {
      const lessons = readLessons(root, { days: 120 }).filter((l) => p.lessons.includes(l.id));
      const nid = await store.createTask({ dept: '스킬관리부', title: `스킬 ${p.action === '스킬 고침' ? '고치기' : '만들기'} · ${p.name}`, instruction: skillInstruction(p, lessons, choice === 2 ? note : null), parent: taskId });
      setLessonState(root, p.lessons, { status: '스킬', job: nid, skill: p.name, decision: id });
      await store.appendLog(taskId, `${p.name} → [[${nid}]] 스킬관리부`);
      runner.start(nid);
      emit('task', { id: nid });
    } else if (p) setLessonState(root, p.lessons, { status: '버림', decision: id });
    const left = store.listDecisions().filter((x) => x.status === '대기' && x.task === `[[${taskId}]]`);
    if (left.length) await store.patchTask(taskId, { status: '결정대기', decision: `[[${left[0].id}]]` });
    else { await store.patchTask(taskId, { status: '완료' }); await store.appendLog(taskId, '제안을 모두 골라 끝냄'); }
    emit('decision', { id, task: taskId });
    emit('task', { id: taskId });
    return { ok: true };
  }
  // 저녁 자동: 평일 18:30 넘으면 그날 배움을 한 번 뽑고, 모인 배움이 3개 넘고 마지막 묶기가 3일 넘었으면 스킬 제안까지
  let learnTimer = null;
  async function learnTick(t = new Date()) {
    const day = stamp(t).slice(0, 10);
    const { runs } = learnState(root);
    if (t.getDay() === 0 || t.getDay() === 6 || stamp(t).slice(11) < '18:30' || String(runs.extract ?? '').startsWith(day) || learn.busy()) return;
    try {
      sessionWords(day);
      await learn.extract({ date: day, scopes: learnScopes() });
      const open = readLessons(root, { days: 60 }).filter((l) => l.status === '모음').length;
      const last = Date.parse(runs.propose ?? '') || 0;
      if (open >= 3 && t - last > 3 * 86400000 && !pendingSkills().length) await proposeSkills();
      emit('task', { id: null });
    } catch (e) { console.error('배움 자동 실패:', e.message); }
  }
  const learnAuto = { start: () => { learnTimer = setInterval(() => learnTick(), 10 * 60000); learnTimer.unref?.(); }, stop: () => clearInterval(learnTimer) };

  // 기억 카드 후보 결재: 세션을 깨우지 않고 서버가 카드를 만든다
  async function answerCard(id, choice, note) {
    const { body } = store.readDecision(id);
    if (choice === 2 && !note?.trim()) throw new StoreError('고쳐서 기억하려면 메모에 고친 규칙을 적어 주세요');
    let cand = null;
    try { cand = JSON.parse(body.match(/```card\s*([\s\S]*?)```/)?.[1] ?? 'null'); } catch { cand = null; }
    const { decision, taskId } = await store.answerDecision(id, choice, note);
    let card = null;
    if (choice !== 3 && cand) card = await store.createCard({ ...cand, rule: choice === 2 ? note : cand.rule, decision: id });
    if (card) await store.appendLog(taskId, `기억 카드 [[${card}]] 만듦`);
    // 남은 후보가 있으면 그것을 기다리고, 다 골랐으면 작업을 마친다
    const left = store.listDecisions().filter((x) => x.status === '대기' && x.task === `[[${taskId}]]`);
    if (left.length) await store.patchTask(taskId, { status: '결정대기', decision: `[[${left[0].id}]]` });
    else { await store.patchTask(taskId, { status: '완료' }); await store.appendLog(taskId, '후보를 모두 골라 끝냄'); }
    emit('decision', { id, task: taskId });
    emit('task', { id: taskId });
    return { ...decision, card };
  }

  // 기억에 질문하기: 읽기 전용 세션이 보관함·참고 폴더를 찾아 답하고, 근거 문서를 지도 점으로 돌려준다
  const ask = createAsk({
    root,
    roots: () => getIndex().syn().scans.map((s) => s.root),
    resolve: (t) => getIndex().syn().resolve(t),
    // [[이름]] → 지도 점: ID 그대로, 아니면 파일 이름·제목이 하나뿐인 점 (예: [[몬티]] → 하위:영상편집부/몬티)
    find: (name) => {
      const nodes = getIndex().graph().nodes.filter((n) => n.type !== '태그' && n.type !== '유령');
      if (nodes.some((n) => n.id === name)) return name;
      const stem = (f) => String(f ?? '').split('/').pop().replace(/\.md$/i, '');
      const hit = nodes.filter((n) => stem(n.file) === name || n.title === name);
      // 같은 이름이 여럿이면 보관함 문서(하위 항목 등)를 참고 폴더보다 먼저
      const vault = hit.filter((n) => !isExtId(n.id));
      return hit.length === 1 ? hit[0].id : vault.length === 1 ? vault[0].id : null;
    },
    ...(runnerOpts.queryFn ? { queryFn: runnerOpts.queryFn } : {}),
  });
  route('POST', '/api/ask', async (req) => {
    const { q } = await req.json();
    const r = await ask(q);
    await remember('주인말', `**질문** ${r.question}${r.sources.length ? ` → 근거 ${r.sources.map((x) => `[[${x}]]`).join(' ')}` : ''}`);
    const byId = new Map(getIndex().graph().nodes.map((n) => [n.id, n]));
    return { ...r, sources: r.sources.map((id) => ({ id, title: byId.get(id)?.title ?? id, type: byId.get(id)?.type ?? null, dept: byId.get(id)?.dept ?? null })) };
  });
  // 타임라인: ?dept=부서 &task=작업 &limit=개수
  route('GET', '/api/timeline', (req) => {
    const q = req.url.searchParams;
    const dept = q.get('dept');
    const task = q.get('task');
    const limit = Math.min(2000, Number(q.get('limit') ?? 400));
    return buildTimeline(store.files()).filter((e) => (!dept || e.dept === dept) && (!task || e.task === task)).slice(0, limit);
  });
  route('GET', '/api/check', () => checkVault(loadVault(root)));

  // PC 사용량 (자원관리부 측정기): 보고 있을 때만 잰다
  const monitor = createMonitor({ sessions: () => [...runner.sessions(), ...external.sessions()] });
  route('GET', '/api/usage', () => monitor.snapshot());
  // PC에서 도는 AI 일 (두뇌가 띄우지 않은 Claude Code 세션·AI 프로그램) — 보고 있을 때만 읽는다
  // Claude Code 훅 (scripts/hook.mjs): 사건으로 상태를 알고, 답으로 세션을 멈추거나 지시를 잇는다
  const hooks = createHooks({ store, emit: (e, d) => { activity?.invalidate(); emit(e, d); } });
  // 코덱스 작업 기록: ~/.codex/sessions의 바뀐 기록을 작업 파일로 (훅이 없어 30초마다 훑는다 — 실제 보관함일 때만 codexAuto.start)
  //   실제 신호 폴더(app/external)로 켠 서버만 이 PC의 ~/.codex를 읽는다 — 시험·데모 보관함은 코덱스 기록을 건드리지 않는다
  const codex = externalDir === EXTERNAL ? createCodexLog({ store, stateFile: path.join(path.dirname(EXTERNAL), 'codex-state.json') }) : null;
  let codexTimer = null;
  const codexAuto = {
    start: () => { if (!codex) return; const go = () => codex.tick().then((r) => { if (r?.more) setTimeout(go, 3000).unref?.(); }).catch((e) => console.error('코덱스 기록 실패', e.message)); go(); codexTimer = setInterval(go, 30000); codexTimer.unref?.(); },
    stop: () => clearInterval(codexTimer),
  };
  route('POST', '/api/codex/sync', () => codex ? codex.tick() : { off: true });
  const activity = createActivity({ store, monitor, hooks, codex });
  const worklog = createWorklog({ store });
  route('GET', '/api/activity', () => activity.snapshot());
  // Claude 사용량 (오늘·5시간 창·세션별 토큰) — 보는 사람이 있을 때만 읽는다
  const tokens = createTokens();
  // 세무달력 (경영지원실 / 재경부): 회사 폴더마다 재경부\세무달력.yaml을 날짜로 펼친다
  const taxcal = createTaxCal({ root: () => store.depts().find((d) => d.name === '경영지원실')?.workdir ?? '' });
  route('GET', '/api/taxcal', () => ({ companies: taxcal.list() }));
  route('POST', '/api/taxcal/done', async (req) => { const { company, key, done } = await req.json(); return taxcal.mark(company, key, !!done); });
  route('GET', '/api/tokens', () => tokens.snapshot({ titles: new Map(activity.snapshot().sessions.map((s) => [s.id, s.title])) }));

  // 알림: 사람이 봐야 할 것이 새로 생기면 윈도우 알림(+ 설정하면 휴대폰). 실제 서버로 켤 때만 (notify: true)
  // 내 차례: 행동 필요(결정·권한·입력대기·승인·실패·멈춤의심) + 새 답(두뇌 검수·바깥 턴 끝). 알림도 같은 목록을 쓴다
  //   key는 알림이 "새로 생긴 것"을 가리는 열쇠라 예전 모양을 지킨다
  const OPEN = new Set(['실행중', '결정대기', '검수']);
  const ORDER = { 권한: 0, 결정: 0, 입력대기: 1, 승인: 2, 실패: 2, 멈춤의심: 3, 검수: 4, 새답: 4 };
  const attention = () => {
    const out = [];
    for (const d of store.listDecisions()) {
      if (d.status !== '대기') continue;
      const task = linkTarget(d.task);
      out.push({ key: `결정:${d.id}`, kind: d.kind === '권한' ? '권한' : '결정', title: d.title, body: `${d.dept ?? ''} · ${d.options?.join(' / ') ?? ''}`, task, decision: d.id, source: '두뇌', at: d.created ?? null });
    }
    for (const p of store.processes()) {
      if (p.phase === '승인대기') out.push({ key: `승인:${p.id}:${p.stage}:${p.run}`, kind: '승인', title: `${p.title} · ${p.stage}`, body: `${p.item ?? ''} — 결과를 보고 다음 단계로 넘길지 고른다`, task: linkTarget(p.run), process: p.id, at: p.updated ?? null });
      if (p.phase === '실패') out.push({ key: `실패:${p.id}:${p.stage}:${p.run}`, kind: '실패', title: `${p.title} · ${p.stage}`, body: `${p.item ?? ''} — 단계가 실패함`, task: linkTarget(p.run), process: p.id, at: p.updated ?? null });
    }
    const bodies = new Map(store.files().filter((f) => f.data?.type === '작업').map((f) => [f.data.id, f.body]));
    for (const t of store.listTasks()) {
      if (!OPEN.has(t.status)) continue;
      if (t.status === '검수') {
        const tracked = isTracked(t);
        const answer = answerKey(bodies.get(t.id));
        out.push({ key: tracked ? `새답:${t.id}:${answer}` : `검수:${t.id}`, kind: tracked ? '새답' : '검수', title: t.title, body: `${t.dept}${t.unit ? ` / ${t.unit}` : ''} — 결과를 확인할 차례`, task: t.id, source: tracked ? '바깥' : '두뇌', session: tracked ? sessionOf(t) : null, at: t.updated ?? null, answer });
      }
      const ext = external.runtime(t.id);
      if (ext?.stalled) out.push({ key: `멈춤:${t.id}:${ext.startedAt}`, kind: '멈춤의심', title: t.title, body: `신호가 1분 넘게 없음 — ${ext.step ?? ''}`, task: t.id, source: '신호', at: ext.beat ?? null });
    }
    for (const s of hooks.list()) {
      if (s.state !== '입력대기') continue;
      const task = worklog.taskOf(s.id);
      const t = task ? store.listTasks().find((x) => x.id === task) : null;
      out.push({ key: `입력:${s.id}:${s.notice}`, kind: '입력대기', title: t?.title ?? s.prompt ?? s.id.slice(0, 8), body: s.notice ?? '', task, session: s.id, source: '바깥', at: s.lastAt, cwd: s.cwd });
    }
    // 같은 작업에 여럿이면 가장 위 종류 하나만 (나머지는 also로)
    const best = new Map();
    for (const x of out.sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9) || String(b.at ?? '').localeCompare(String(a.at ?? '')))) {
      const k = x.task ?? x.key;
      if (!best.has(k)) best.set(k, { ...x, also: [] });
      else best.get(k).also.push(x.kind);
    }
    return [...best.values()];
  };
  // 오늘 끝남 = 오늘 검수 기억 파일의 "완료" 줄 수 (updated로 세지 않는다 — 이름만 고쳐도 오늘이 되므로)
  const doneToday = () => {
    const f = path.join(root, '기억', `검수-${stamp(new Date()).slice(0, 10)}.md`);
    try { return (fs.readFileSync(f, 'utf8').match(/^- \d\d:\d\d \*\*완료\*\*/gm) ?? []).length; } catch { return 0; }
  };
  const sessions = createSessions({ store, runner, hooks, external, activity, tokens, worklog, transcript });
  // 일정비서: 비서실 하위 문서를 1분마다 오늘 것으로 (바뀔 때만 쓴다). 바깥 일은 기억/일정비서-<날>.json에서
  const today = createToday({ root, emit, collect: () => ({ tasks: store.listTasks(), attention: attention() }) });
  route('GET', '/api/today', () => today.view());
  route('POST', '/api/today', () => ({ changed: today.refresh() }));
  // 할 일 카드에서 시키기: 처음이면 비서실 / 일정비서 작업을 만들어 잇고, 이미 이어져 있으면 그 작업에 이어서 시킨다
  route('POST', '/api/today/ask', async (req) => {
    const { id, text } = await req.json();
    if (!id || !text?.trim()) throw new StoreError('id와 시킬 말이 필요함');
    const card = today.cardOf(String(id));
    if (!card) throw new StoreError('그 일정이 오늘 목록에 없음 (이미 끝났거나 바뀜)', 404);
    if (card.task && card.source !== '두뇌') return { task: card.task, linked: true };
    const title = `${card.target && card.source !== '두뇌' ? `${card.target} · ` : ''}${card.title}`.slice(0, 60);
    const task = await store.createTask({ dept: '비서실', unit: '일정비서', title, instruction: askInstruction(card, text) });
    runner.start(task);
    today.link(String(id), task);
    await remember('주인말', `**지시** [[${task}]] 비서실 / 일정비서 — ${text.trim()} (할 일: ${card.title})`);
    emit('task', { id: task });
    return { task, linked: false };
  });
  route('POST', '/api/today/done', async (req) => {
    const { id, undo = false, skip = false } = await req.json();
    if (!id) throw new StoreError('id가 필요함');
    const card = today.clear(String(id), { undo: !!undo, skip: !!skip });
    if (!card) throw new StoreError('그 일정이 오늘 목록에 없음 (이미 끝났거나 바뀜)', 404);
    await remember('주인말', `**일정 ${undo ? '되살림' : skip ? '스킵(내 일 아님)' : '완료'}** ${card.source ?? ''} · ${card.title}`);
    emit('task', { id: null });
    return today.view();
  });
  route('GET', '/api/attention', () => attention());
  route('GET', '/api/sessions', () => sessions.list());
  route('GET', '/api/chips', () => ({ 계속: chipText('계속'), 한국어로: chipText('한국어로'), '지금 게시': chipText('지금 게시') }));
  const notifier = createNotifier({ file: NOTIFY_FILE(path.dirname(fileURLToPath(import.meta.url))), items: attention, poll: notify ? undefined : 0, log: (m) => console.error(m) });
  route('GET', '/api/notify', () => notifier.status());
  route('POST', '/api/notify/test', () => notifier.test());
  route('POST', '/api/hooks', async (req) => {
    const ev = await req.json();
    // 두뇌가 띄운 세션은 runner가 직접 다룬다
    if (store.listTasks().some((t) => t.session && t.session === ev.session_id)) return {};
    const brainTask = req.headers['x-brain-task'] || null;
    if (brainTask) { await worklog.track(ev, null, { brainTask }); return {}; }
    const out = hooks.handle(ev);
    // 훅 답(1.5초 제한)을 늦추지 않게: 작업 기록·화면 알림은 응답을 보낸 뒤에
    setImmediate(() => {
      worklog.track(ev, hooks.get(ev.session_id), { blocked: ev.hook_event_name === 'Stop' && out?.decision === 'block' })
        .then((task) => {
          const id = task ?? `cc:${ev.session_id}`;
          if (ev.hook_event_name === 'PreToolUse') emit('tool', { id, name: ev.tool_name, label: toolLabel(ev.tool_name, 1), now: hooks.get(ev.session_id)?.now });
          if (ev.hook_event_name === 'Stop' && ev.last_assistant_message) emit('text', { id, text: ev.last_assistant_message });
          emit('session', { id, state: hooks.get(ev.session_id)?.state ?? null });
          if (task && ['UserPromptSubmit', 'Stop'].includes(ev.hook_event_name)) emit('task', { id: task });
        })
        .catch((e) => console.error('작업 기록 실패', e.message));
    });
    return { out };
  });
  // 바깥 세션 제어: { stop: true } 다음 도구 전에 멈춤 · { message } 지시 이어 주기
  route('POST', '/api/activity/sessions/([^/]+)/control', async (req, [id]) => {
    const r = hooks.control(id, await req.json());
    if (!r.ok) throw new StoreError(r.error, 409);
    return r;
  });
  route('POST', '/api/activity/sessions/([^/]+)/cancel', async (req, [id]) => {
    let msg = null;
    try { msg = (await req.json())?.message ?? null; } catch { msg = null; }
    return hooks.cancel(id, msg);
  });
  // AI 프로그램 끝내기: 지금 목록에 있는 묶음만 (아무 pid나 죽이지 않게), 프로세스 나무째
  route('POST', '/api/activity/programs/stop', async (req) => {
    const { key } = await req.json();
    const g = activity.snapshot().programs.find((x) => x.key === key);
    if (!g) throw new StoreError('지금 도는 프로그램 목록에 없음', 404);
    const results = await Promise.all(g.pids.map((pid) => new Promise((resolve) => {
      execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, (err) => resolve({ pid, ok: !err }));
    })));
    activity.invalidate();
    return { key, results };
  });

  route('GET', '/api/events', (req, _m, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': 연결됨\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return undefined;
  });

  // 화면: web/dist (npm run build). /api 밖의 GET은 모두 화면 파일, 없으면 index.html
  route('GET', '/(?!api/).*', (req, _m, res) => {
    const rel = path.normalize(decodeURIComponent(req.url.pathname)).replace(/^[\\/]+/, '');
    let file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    if (!fs.existsSync(file)) return { name: 'SYNAPSE BRAIN', ui: '화면이 아직 빌드되지 않음 — app/web에서 npm run build' };
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
    return undefined;
  });

  const server = http.createServer(async (req, res) => {
    // 다른 사이트가 브라우저를 통해 이 서버를 부르지 못하게 Host를 확인한다
    const host = (req.headers.host ?? '').split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(host)) { res.writeHead(403).end(); return; }

    const url = new URL(req.url, `http://${req.headers.host}`);
    req.url = url;
    req.json = () => new Promise((resolve, reject) => {
      if (!/application\/json/.test(req.headers['content-type'] ?? '')) { reject(new StoreError('content-type은 application/json', 415)); return; }
      // 조각을 모은 뒤 한 번에 UTF-8로 풀어야 한글이 조각 경계에서 깨지지 않는다
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { chunks.push(c); size += c.length; if (size > 1e6) req.destroy(); });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new StoreError('JSON 형식 오류')); }
      });
    });

    // 경로는 인코딩된 채로 맞추고, 잡힌 조각만 푼다 (문서 ID에 '/'가 들어갈 수 있다: 하위:부서/이름)
    const path_ = url.pathname;
    const r = routes.find((x) => x.method === req.method && x.re.test(path_));
    if (!r) { send(res, 404, { error: '없는 경로' }); return; }
    const t0 = Date.now();
    lastWork = { what: `${req.method} ${path_}`, at: t0 };
    try {
      const out = await r.fn(req, path_.match(r.re).slice(1).map((m) => (m == null ? m : decodeURIComponent(m))), res);
      if (out !== undefined) send(res, 200, out);
    } catch (e) {
      send(res, e.status ?? 500, { error: e.message });
    }
    // 오래 걸린 요청은 멈춤 기록에 남긴다 (스트림 /api/events 제외)
    const took = Date.now() - t0;
    if (took > 3000 && !path_.startsWith('/api/events')) stallLog(`느린 요청 ${req.method} ${path_} — ${(took / 1000).toFixed(1)}초`);
  });

  return {
    store, runner, scheduler, external, pipeline, emit, today, learnAuto, codex, codexAuto,
    warm: () => getIndex().graph(),
    listen: () => new Promise((resolve) => server.listen(port, HOST, () => resolve(server.address().port))),
    close: () => { scheduler.stop(); today.stop(); learnAuto.stop(); pipeline.close(); notifier.close(); monitor.stop(); external.close(); stopWatch(); for (const c of clients) c.end(); server.close(); },
  };
}

// PowerShell 명령 하나 (출력은 UTF-8로, 끝 6000자만). 백그라운드로 띄우는 명령(Start-Process)은 바로 돌아온다
function runCommand(cmd, { cwd, timeout = 90_000 } = {}) {
  return new Promise((resolve) => {
    const ps = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding\n${cmd}`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { cwd, windowsHide: true });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* 없음 */ }
    let out = '';
    const take = (c) => { out = (out + c.toString('utf8')).slice(-6000); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => { child.kill(); out += '\n(90초가 넘어 멈춤)'; }, timeout);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim() }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: e.message }); });
  });
}

// 멈춤 기록: 서버가 몇 초씩 응답을 못 하면 logs/stall.log에 바로 적는다 (서버가 살아 있는 동안에도 읽을 수 있게)
let lastWork = { what: '시작', at: Date.now() };
const STALL_LOG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logs', 'stall.log');
function stallLog(line) {
  const d = new Date();
  const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 8)}`;
  try { fs.mkdirSync(path.dirname(STALL_LOG), { recursive: true }); fs.appendFileSync(STALL_LOG, `${ts} ${line}
`); } catch { /* 기록 실패는 무시 */ }
}
function watchStalls() {
  let prev = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    const gap = now - prev - 500;
    prev = now;
    if (gap > 2000) stallLog(`멈춤 ${(gap / 1000).toFixed(1)}초 — 마지막 요청 ${lastWork.what} (${((now - lastWork.at) / 1000).toFixed(0)}초 전 시작)`);
  }, 500);
  t.unref?.();
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// 서버를 다시 켰을 때 실행중이던 작업은 세션이 없으므로 기록만 남긴다 (바깥에서 도는 일은 그대로)
async function markInterrupted(store, external) {
  for (const t of store.listTasks()) {
    if (t.status === '실행중' && !external.runtime(t.id) && !isTracked(t)) await store.appendLog(t.id, '서버가 다시 켜짐 — 세션이 멈춰 있음. 메시지를 보내면 이어서 한다.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(arg('--vault', path.join(here, '..', 'vault')));
  // 바깥 일 신호 폴더: 실제 보관함이면 app/external, 다른 보관함(데모·시험)이면 그 안의 .external — 실제 신호와 섞이지 않게
  const realVault = root === path.resolve(path.join(here, '..', 'vault'));
  const srv = createServer({ root, port: Number(arg('--port', 4747)), notify: realVault && !process.argv.includes('--no-notify'), externalDir: arg('--external', realVault ? EXTERNAL : path.join(root, '.external')) });
  await markInterrupted(srv.store, srv.external);
  const port = await srv.listen();
  // --no-schedule: 예약 실행기 없이 (화면 확인용 서버 등)
  if (!process.argv.includes('--no-schedule')) { srv.scheduler.start(); if (realVault) { srv.today.start(); srv.learnAuto.start(); srv.codexAuto.start(); } }
  // 참고 문서 폴더를 미리 훑어 둔다 (처음 지도를 열 때 기다리지 않게)
  setTimeout(() => { try { srv.warm?.(); } catch { /* 지도 열 때 다시 */ } }, 50);
  watchStalls();
  stallLog(`서버 시작 (pid ${process.pid})`);
  console.log(`SYNAPSE BRAIN 서버: http://${HOST}:${port}  (보관함 ${root})`);
}
