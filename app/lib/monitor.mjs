// PC 사용량 측정기 (자원관리부): CPU·RAM·GPU 전체 사용률과, 지금 도는 작업 세션·무거운 프로그램이 각각 몇 %를 쓰는지.
// 누가 보고 있을 때만 잰다 — 첫 요청 때 scripts/usage.ps1을 낮은 우선순위로 띄우고, 한동안 요청이 없으면 끈다.
// 작업 세션 몫 = 그 세션 프로세스(claude.exe)와 그 아래 자식 프로세스(ffmpeg·python 등) 전부의 합.
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'usage.ps1');
const TOP = 8;

// 여러 프로세스로 도는 프로그램은 이름으로 묶는다 (chrome.exe 30개 → 한 줄)
export function summarize(sample, { sessions = [], serverPid = process.pid, cores = os.cpus().length, ram, cpu } = {}) {
  const procs = sample?.procs ?? [];
  const kids = new Map();
  for (const p of procs) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)).push(p);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const taken = new Set();
  const tree = (pid) => {
    const out = [];
    const walk = (id) => {
      const p = byPid.get(id);
      if (!p || taken.has(id)) return;
      taken.add(id);
      out.push(p);
      for (const c of kids.get(id) ?? []) if (c.pid !== id) walk(c.pid);
    };
    walk(pid);
    return out;
  };
  const vramTotal = sample?.gpu?.memTotal ?? 0;
  const sum = (list) => {
    const s = { cpu: 0, mem: 0, gpu: 0, vram: 0 };
    for (const p of list) { s.cpu += p.cpu; s.mem += p.mem; s.gpu += p.gpu; s.vram += p.vram; }
    return {
      cpu: round(s.cpu / cores), mem: s.mem, memPct: ram?.total ? round((s.mem / ram.total) * 100) : 0,
      gpu: round(Math.min(100, s.gpu)), vram: s.vram, vramPct: vramTotal ? round((s.vram / vramTotal) * 100) : 0,
    };
  };
  const procsOf = (list) => [...new Set(list.map((p) => p.name.replace(/\.exe$/i, '')))].slice(0, 6);

  // 작업 세션부터 떼어 낸다 (세션 아래 자식이 서버 몫으로 세지지 않게)
  const tasks = sessions.map((s) => {
    const list = tree(s.pid);
    return { task: s.id, pid: s.pid, count: list.length, procs: procsOf(list), ...sum(list) };
  });
  const serverList = tree(serverPid);
  const server = { count: serverList.length, procs: procsOf(serverList), ...sum(serverList) };

  const groups = new Map();
  for (const p of procs) {
    if (taken.has(p.pid) || /^(Idle|System Idle Process)$/i.test(p.name)) continue;
    const g = groups.get(p.name) ?? groups.set(p.name, { name: p.name.replace(/\.exe$/i, ''), list: [] }).get(p.name);
    g.list.push(p);
  }
  const score = (x) => x.cpu + x.memPct + x.gpu + x.vramPct;
  const top = [...groups.values()]
    .map((g) => ({ name: g.name, count: g.list.length, ...sum(g.list) }))
    .sort((a, b) => score(b) - score(a))
    .slice(0, TOP);

  const gpu = sample?.gpu ? {
    name: sample.gpu.name, util: sample.gpu.util, temp: sample.gpu.temp,
    memUsed: sample.gpu.memUsed, memTotal: sample.gpu.memTotal,
    memPct: sample.gpu.memTotal ? round((sample.gpu.memUsed / sample.gpu.memTotal) * 100) : 0,
  } : null;
  return { at: sample?.at ?? Date.now(), cores, cpu, ram, gpu, tasks, server, top };
}

const round = (n) => Math.round(n * 10) / 10;

export function createMonitor({ sessions = () => [], interval = 4, idleMs = 60_000, script = SCRIPT } = {}) {
  let child = null;
  let last = null;        // 마지막으로 받은 원본 표본
  let lastAsk = 0;
  let prevCpu = null;
  let cpuPct = 0;
  let timer = null;
  let buf = '';

  const cpuTimes = () => os.cpus().reduce((a, c) => {
    const t = c.times;
    a.idle += t.idle;
    a.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return a;
  }, { idle: 0, total: 0 });
  const tickCpu = () => {
    const now = cpuTimes();
    if (prevCpu && now.total > prevCpu.total) cpuPct = round(100 * (1 - (now.idle - prevCpu.idle) / (now.total - prevCpu.total)));
    prevCpu = now;
  };

  function start() {
    if (child) return;
    tickCpu();
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Interval', String(interval)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    // 측정기 자체가 일을 방해하지 않게 낮은 우선순위로
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* 안 되면 그대로 */ }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { last = JSON.parse(line); tickCpu(); } catch { /* 깨진 줄은 버린다 */ }
      }
    });
    child.on('exit', () => { child = null; buf = ''; });
    timer = setInterval(() => { if (Date.now() - lastAsk > idleMs) stop(); }, 10_000);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    if (child) { child.kill(); child = null; }
  }

  // 지금 값: 측정기가 꺼져 있으면 켜고, 첫 표본 전에는 전체 CPU·RAM만 준다
  function snapshot() {
    lastAsk = Date.now();
    start();
    if (!last) tickCpu();
    const total = os.totalmem();
    const used = total - os.freemem();
    const ram = { used, total, pct: round((used / total) * 100) };
    return { ...summarize(last, { sessions: sessions(), ram, cpu: cpuPct }), warming: !last };
  }

  // 원본 표본 (프로세스별 값·명령줄) — PC 작업 추적(lib/activity.mjs)이 쓴다. 이것도 "보고 있음"으로 친다
  function raw() {
    lastAsk = Date.now();
    start();
    return last;
  }

  return { snapshot, raw, stop, running: () => !!child };
}
