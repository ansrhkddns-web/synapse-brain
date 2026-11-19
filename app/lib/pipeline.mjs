// 공정 실행기 (반자동화): 공정 문서의 단계를 하나씩 돌리고, 단계 사이에 사람 승인을 받는다.
//   공정 문서 frontmatter
//     steps:                       # 단계 이름 → 실행 정의 (없는 단계는 사람이 하는 단계 — "다음 단계로"로 넘긴다)
//       대본: { do: "…세션에 줄 지시…", gate: true }
//       최종 렌더: { cmd: 'python render.py "{item}"', group: 렌더 }
//     auto: true                   # 승인이 필요 없는 단계가 끝나면 다음 단계를 바로 돌린다
//     phase: 대기|대기열|실행|승인대기|실패|끝   run: "[[W-…]]"   ← 실행기가 적는다
//   do  = 그 부서·하위 항목 앞으로 작업 하나를 만들어 두뇌 세션이 그 단계만 하게 한다 (결과 보고 = 단계 끝)
//   cmd = 명령을 작업 폴더에서 낮은 우선순위로 돌린다. {item} {slug} {workdir} {task} {stage} {scripts} 를 바꿔 넣는다. 0으로 끝나면 단계 끝
//   slug = 작업물의 폴더 이름 (예: carnival_of_souls) — 명령에 쓰는 이름. 없으면 item
//   group = 같은 그룹은 동시에 GROUPS[그룹]개까지 (렌더·LLM·업로드 1개 — 사용자 전역 규칙). 나머지는 대기열
// 상태는 공정 문서에 적으므로 서버를 다시 켜도 이어진다 (돌던 명령은 결과를 모르므로 "실패"로 두고 다시 돌릴 수 있게).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linkTarget } from './vault.mjs';
import { writeBeat } from '../scripts/beat.mjs';

export const GROUPS = { 렌더: 1, LLM: 1, 업로드: 1 };
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const POLL_MS = 5_000;
const DONE = ['검수', '완료'];

// 단계 정의 읽기 (없으면 사람이 하는 단계)
export function stepOf(p, stage = p.stage ?? p.stages[0]) {
  const d = p.steps?.[stage];
  if (!d || (typeof d.do !== 'string' && typeof d.cmd !== 'string')) return null;
  return { stage, kind: d.cmd ? 'cmd' : 'do', text: d.cmd ?? d.do, gate: d.gate === true, group: d.group ?? null };
}
export const fill = (s, v) => String(s).replace(/\{(item|slug|workdir|task|stage|scripts)\}/g, (_, k) => v[k] ?? '');

export function createPipeline({ store, runner, emit = () => {}, externalDir, poll = POLL_MS, spawnFn = spawn, groups = GROUPS }) {
  const running = new Map();   // 공정 id → { task, group, child? }
  const queue = [];            // 그룹 자리가 나기를 기다리는 공정 id
  const procOf = (id) => {
    const p = store.processes().find((x) => x.id === id);
    if (!p) throw Object.assign(new Error(`없는 공정: ${id}`), { status: 404 });
    return p;
  };
  const busy = (g) => [...running.values()].filter((r) => r.group === g).length;
  const free = (g) => !g || !(g in groups) || busy(g) < groups[g];
  const patch = async (id, x) => { const r = await store.patchProcess(id, x); emit('process', { id, phase: r.phase }); return r; };
  const err = (msg, status = 409) => Object.assign(new Error(msg), { status });

  // 지금 단계를 돌린다 (그룹이 차 있으면 대기열)
  async function run(id) {
    const p = procOf(id);
    if (running.has(id) || p.phase === '대기열') throw err('이미 돌고 있거나 대기열에 있음');
    if (!p.item) throw err('작업물(item)이 없음 — 먼저 작업물을 정한다');
    const st = stepOf(p);
    if (!st) throw err(`"${p.stage ?? p.stages[0]}" 단계는 실행 정의가 없는 사람 단계 — 하고 나서 "다음 단계로"`);
    if (!free(st.group)) {
      if (!queue.includes(id)) queue.push(id);
      return patch(id, { phase: '대기열', status: '가동', stage: st.stage });
    }
    return launch(p, st);
  }

  async function launch(p, st) {
    const i = p.stages.indexOf(st.stage);
    const t = await store.createTask({
      dept: p.dept, unit: p.unit ?? null, status: '실행중', tags: ['공정'],
      title: `${p.title} · ${st.stage} — ${p.item}`.slice(0, 60),
      instruction: st.kind === 'do'
        ? [`[공정 ${p.title}] ${i + 1}/${p.stages.length}단계 "${st.stage}" — 작업물: ${p.item}`,
          p.workdir && `작업 폴더: ${p.workdir}`,
          `공정 문서: ${path.join(store.root, '부서', p.dept, '공정', `${p.id}.md`)} (단계별 방법은 이 문서와 하위 항목 문서를 따른다)`,
          '', fill(st.text, { item: p.item, slug: p.slug ?? p.item, workdir: p.workdir ?? '', stage: st.stage, scripts: SCRIPTS }), '',
          `이 단계("${st.stage}")만 하고 submit_result로 결과(만든 파일 경로)를 보고한다. 다음 단계는 하지 않는다 — 다음 단계는 사람이 확인한 뒤 실행기가 넘긴다.`].filter((x) => x !== false && x != null).join('\n')
        : `[공정 ${p.title}] ${i + 1}/${p.stages.length}단계 "${st.stage}" — 작업물: ${p.item}\n명령 단계 (실행기가 직접 돌림): ${st.text}`,
    });
    const task = t.id ?? t;
    running.set(p.id, { task, group: st.group });
    await patch(p.id, { phase: '실행', status: '가동', stage: st.stage, run: `[[${task}]]` });
    if (st.kind === 'do') runner.start(task);
    else startCmd(p, st, task);
    return { task };
  }

  // 명령 단계: cmd.exe로 작업 폴더에서, 낮은 우선순위, 바깥 일 신호로 화면에 "작업 중"
  function startCmd(p, st, task) {
    const cmd = fill(st.text, { item: p.item, slug: p.slug ?? p.item, workdir: p.workdir ?? '', task, stage: st.stage, scripts: SCRIPTS });
    const stopFile = path.join(externalDir, `${task}.stop`);
    const child = spawnFn('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], {
      cwd: p.workdir && fs.existsSync(p.workdir) ? p.workdir : undefined, windowsHide: true, windowsVerbatimArguments: true,
      env: { ...process.env, BRAIN_TASK: task, PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* 없음 */ }
    running.get(p.id).child = child;
    const beat = (x) => { try { writeBeat(task, x, externalDir); } catch { /* 신호는 덤 */ } };
    // 일이 스스로 진행률을 쓰면(ffprog·brainbeat) 그것이 이긴다 — 여기서는 단계·마지막 줄만
    beat({ step: st.stage, line: cmd.slice(0, 120), pid: child.pid, stop: stopFile, finished: undefined });
    let tail = '';
    const onOut = (c) => {
      tail = (tail + c.toString('utf8')).slice(-4000);
      const line = tail.split(/\r?\n|\r/).map((x) => x.trim()).filter(Boolean).at(-1);
      if (line) beat({ line: line.slice(0, 160) });
    };
    child.stdout?.on('data', onOut);
    child.stderr?.on('data', onOut);
    const watch = setInterval(() => {
      if (!fs.existsSync(stopFile)) return;
      try { fs.unlinkSync(stopFile); } catch { /* 없음 */ }
      execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }, () => {});
    }, 1000);
    watch.unref?.();
    child.on('exit', async (code) => {
      clearInterval(watch);
      beat({ finished: true, line: code === 0 ? '끝' : `종료 코드 ${code}` });
      const last = tail.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(-3).join(' / ').slice(0, 200);
      await store.appendLog(task, code === 0 ? `명령 끝 (0)${last ? ` — ${last}` : ''}` : `⚠ 명령 실패 (종료 코드 ${code}) — ${last}`).catch(() => {});
      await store.patchTask(task, { status: '검수' }).catch(() => {});
      emit('task', { id: task });
      await finish(p.id, code === 0).catch((e) => console.error('공정 마무리 실패:', e.message));
    });
  }

  // 단계가 끝남 → 승인 대기 / 다음 단계(auto) / 다음 단계 대기 / 마지막이면 끝
  async function finish(id, ok) {
    const r = running.get(id);
    running.delete(id);
    const p = procOf(id);
    pump();
    if (!ok) return patch(id, { phase: '실패' });
    const st = stepOf(p);
    if (st?.gate) return patch(id, { phase: '승인대기' });
    return advance(id, { auto: true, from: r });
  }

  // 다음 단계로 (사람 단계를 했거나, 승인했거나, auto)
  async function advance(id, { auto = false } = {}) {
    const p = procOf(id);
    if (running.has(id)) throw err('단계가 돌고 있음 — 끝나거나 멈춘 뒤에');
    const i = p.stages.indexOf(p.stage ?? p.stages[0]);
    if (i >= p.stages.length - 1) return patch(id, { phase: '끝', status: '정지', run: undefined });
    const next = p.stages[i + 1];
    const q = await patch(id, { stage: next, phase: '대기', run: undefined });
    if (auto && p.auto && stepOf(q, next)) return run(id);
    return q;
  }

  // 승인: 승인 대기 단계를 통과시킨다 (note는 작업 기록에)
  async function approve(id, note) {
    const p = procOf(id);
    if (p.phase !== '승인대기') throw err('승인을 기다리는 단계가 아님');
    const task = linkTarget(p.run);
    if (task) await store.appendLog(task, `공정 승인 — 다음 단계로${note ? ` (${note})` : ''}`).catch(() => {});
    return advance(id, { auto: true });
  }

  // 같은 단계를 다시 (실패했거나 승인 대신 고쳐 달라고 할 때). note는 새 지시에 붙인다
  async function retry(id, note) {
    const p = procOf(id);
    if (running.has(id)) throw err('단계가 돌고 있음');
    if (note && p.steps?.[p.stage]?.do) {
      const st = stepOf(p);
      return launch(p, { ...st, text: `${st.text}\n\n사람이 앞 결과를 보고 남긴 말: ${note}` });
    }
    await patch(id, { phase: '대기' });
    return run(id);
  }

  // 멈추기: 도는 단계를 멈추고 공정을 정지로 (단계 위치는 그대로 — 나중에 이어서)
  async function stop(id) {
    const r = running.get(id);
    const qi = queue.indexOf(id);
    if (qi >= 0) queue.splice(qi, 1);
    if (r?.child) { try { fs.writeFileSync(path.join(externalDir, `${r.task}.stop`), 'stop'); } catch { /* 없음 */ } }
    else if (r) runner.stop(r.task);
    running.delete(id);
    pump();
    return patch(id, { phase: '대기', status: '정지' });
  }

  // 지금 단계를 바로 옮긴다 (문서 대조에서 "실제 파일로는 여기까지 끝남"을 맞출 때)
  async function setStage(id, stage) {
    const p = procOf(id);
    if (running.has(id) || p.phase === '대기열') throw err('단계가 돌고 있거나 대기열에 있음');
    if (!p.stages.includes(stage)) throw err(`없는 단계: ${stage}`, 400);
    return patch(id, { stage, phase: '대기', run: undefined });
  }

  // 새 작업물로 처음 단계부터 (끝났거나 다른 영화로 넘어갈 때)
  async function startItem(id, item, { go = false, slug } = {}) {
    if (!item?.trim()) throw err('작업물 이름이 비었음', 400);
    if (running.has(id)) throw err('단계가 돌고 있음');
    const p = procOf(id);
    await patch(id, { item: item.trim(), slug: slug?.trim() || undefined, stage: p.stages[0], phase: '대기', status: '가동', run: undefined });
    return go ? run(id) : procOf(id);
  }

  function pump() {
    for (const id of [...queue]) {
      let p;
      try { p = procOf(id); } catch { queue.splice(queue.indexOf(id), 1); continue; }
      const st = stepOf(p);
      if (!st) { queue.splice(queue.indexOf(id), 1); continue; }
      if (!free(st.group)) continue;
      queue.splice(queue.indexOf(id), 1);
      launch(p, st).catch((e) => console.error('공정 단계 시작 실패:', e.message));
    }
  }

  // 세션 단계가 끝났는지 본다 (작업이 검수·완료가 되면 단계 끝). 서버를 다시 켜면 실행 중이던 단계를 다시 붙잡는다
  function check() {
    for (const p of store.processes()) {
      if (p.phase !== '실행' && p.phase !== '대기열') continue;
      const task = linkTarget(p.run);
      if (p.phase === '대기열') { if (!queue.includes(p.id) && !running.has(p.id)) queue.push(p.id); continue; }
      if (!task) continue;
      let status;
      try { status = store.readTask(task).data.status; } catch { continue; }
      const st = stepOf(p);
      if (!running.has(p.id)) {
        // 서버가 다시 켜짐: 명령 단계는 결과를 모르니 실패로, 세션 단계는 다시 지켜본다
        if (st?.kind === 'cmd') { patch(p.id, { phase: '실패' }).catch(() => {}); store.appendLog(task, '⚠ 서버가 다시 켜져 명령 결과를 모름 — 다시 돌린다').catch(() => {}); continue; }
        running.set(p.id, { task, group: st?.group ?? null });
      }
      if (running.get(p.id).child) continue;   // 명령 단계는 끝날 때 스스로 알린다
      if (DONE.includes(status)) finish(p.id, true).catch((e) => console.error('공정 마무리 실패:', e.message));
      else if (status === '취소') { running.delete(p.id); patch(p.id, { phase: '실패' }).catch(() => {}); pump(); }
    }
    pump();
  }
  const timer = poll ? setInterval(check, poll) : null;
  timer?.unref?.();

  return {
    // 사람 단계를 하고 넘길 때도 auto면 다음 실행 단계를 바로 돌린다
    run, approve, retry, advance: (id) => advance(id, { auto: true }), stop, startItem, setStage, check,
    view: () => ({ running: [...running].map(([id, r]) => ({ id, task: r.task, group: r.group })), queue: [...queue], groups }),
    close: () => timer && clearInterval(timer),
  };
}
