// ffmpeg 진행률을 두뇌 화면에 — ffmpeg를 대신 띄우고 -progress 출력으로 %·남은 시간을 신호(external/<id>.json)에 쓴다.
//   node ffprog.mjs <작업 id> [--step 이름] [--duration 초] -- <ffmpeg 인자 …>
// - 전체 길이: --duration, 없으면 첫 -i 입력을 ffprobe로 (인자에 -t가 있으면 더 짧은 쪽)
// - 사용자 규칙: 우선순위 BelowNormal, -threads가 없으면 10 (출력 파일 바로 앞에 넣는다)
// - 화면의 중지 버튼 → external/<id>.stop 생김 → ffmpeg에 'q'(깔끔히 끝냄), 5초 안에 안 끝나면 강제 종료
// - 끝나면 finished 신호, ffmpeg와 같은 종료 코드로 끝난다. ffmpeg 로그(stderr)는 그대로 보인다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXTERNAL, writeBeat } from './beat.mjs';

const EVERY_MS = 2000;
// ffmpeg 위치: FFMPEG 환경 변수 → 영상편집 공용 ffmpeg → PATH
const SHARED = '';
export const FFMPEG = process.env.FFMPEG || (fs.existsSync(SHARED) ? SHARED : 'ffmpeg');
const FFPROBE = /ffmpeg(\.exe)?$/i.test(FFMPEG) ? FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m, e) => `ffprobe${e ?? ''}`) : 'ffprobe';

// "-progress pipe:1" 출력: key=value 줄, progress=continue|end 로 한 묶음이 끝난다
export function parseProgress(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  // out_time_us가 정확하다 (out_time_ms도 이름과 달리 µs)
  const us = Number(out.out_time_us ?? out.out_time_ms);
  const speed = parseFloat(out.speed);
  return {
    sec: Number.isFinite(us) && us >= 0 ? us / 1e6 : null,
    speed: Number.isFinite(speed) ? speed : null,
    fps: Number(out.fps) || null,
    frame: Number(out.frame) || null,
    end: out.progress === 'end',
  };
}

const timeArg = (v) => {
  if (v == null) return null;
  const p = String(v).split(':').map(Number);
  return p.some((x) => !Number.isFinite(x)) ? null : p.reduce((a, x) => a * 60 + x, 0);
};

export function probeDuration(args) {
  const i = args.indexOf('-i');
  let total = null;
  if (i >= 0 && args[i + 1]) {
    const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', args[i + 1]], { encoding: 'utf8', windowsHide: true });
    const d = parseFloat(r.stdout);
    if (Number.isFinite(d) && d > 0) total = d;
  }
  const t = timeArg(args[args.indexOf('-t') + 1]);
  if (args.includes('-t') && t > 0) total = total ? Math.min(total, t) : t;
  return total;
}

export function withRules(args) {
  const a = [...args];
  if (!a.includes('-threads') && a.length) a.splice(a.length - 1, 0, '-threads', '10');
  return ['-progress', 'pipe:1', '-nostats', ...a];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const id = argv[0];
  if (!id || sep < 0) { console.error('쓰는 법: node ffprog.mjs <작업 id> [--step 이름] [--duration 초] -- <ffmpeg 인자 …>'); process.exit(2); }
  const opt = argv.slice(1, sep);
  const ff = argv.slice(sep + 1);
  const o = (k) => { const i = opt.indexOf(`--${k}`); return i >= 0 ? opt[i + 1] : undefined; };
  const step = o('step') ?? `ffmpeg → ${path.basename(ff.at(-1) ?? '')}`;
  const total = Number(o('duration')) || probeDuration(ff);
  const stopFile = path.join(EXTERNAL, `${id}.stop`);
  try { fs.unlinkSync(stopFile); } catch { /* 없음 */ }

  const child = spawn(FFMPEG, withRules(ff), { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* 권한 없음 */ }
  writeBeat(id, { step, line: 'ffmpeg 시작', pid: child.pid, stop: stopFile, done: 0, total: total ?? undefined, unit: '초', finished: undefined });

  let buf = '';
  let last = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    buf += c;
    let k;
    while ((k = buf.indexOf('progress=')) >= 0) {
      const nl = buf.indexOf('\n', k);
      if (nl < 0) break;
      const p = parseProgress(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (Date.now() - last < EVERY_MS && !p.end) continue;
      last = Date.now();
      const eta = total && p.sec != null && p.speed > 0 ? Math.max(0, (total - p.sec) / p.speed) : undefined;
      writeBeat(id, {
        step, done: p.sec != null ? Math.round(p.sec * 10) / 10 : undefined, total: total ?? undefined, unit: '초', eta: eta != null ? Math.round(eta) : undefined,
        line: [p.speed && `속도 ${p.speed}x`, p.fps && `${p.fps} fps`, p.frame && `프레임 ${p.frame}`].filter(Boolean).join(' · '),
      });
    }
  });

  // 화면의 중지 버튼
  let stopping = false;
  const watch = setInterval(() => {
    if (stopping || !fs.existsSync(stopFile)) return;
    stopping = true;
    writeBeat(id, { line: '중지 요청 — 깔끔히 끝내는 중' });
    try { child.stdin.write('q'); } catch { /* 이미 끝남 */ }
    setTimeout(() => { if (child.exitCode == null) child.kill(); }, 5000).unref();
  }, 1000);

  child.on('exit', (code, signal) => {
    clearInterval(watch);
    try { fs.unlinkSync(stopFile); } catch { /* 없음 */ }
    writeBeat(id, { finished: true, line: stopping ? '중지됨' : code === 0 ? '끝' : `ffmpeg 오류 (${code ?? signal})` });
    process.exit(code ?? 1);
  });
  child.on('error', (e) => { console.error(`ffmpeg를 띄우지 못함: ${e.message}`); writeBeat(id, { finished: true, line: `ffmpeg 없음: ${e.message}` }); process.exit(127); });
}
