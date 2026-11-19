import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createExternal, readBeat, STALE_MS } from '../lib/external.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-ext-'));
const iso = (ms) => new Date(ms).toISOString();

test('바깥 일: 최근 신호는 실행 중, 오래된 신호·깨진 파일은 없음', () => {
  const dir = tmp();
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'A.json'), '﻿' + JSON.stringify({ startedAt: iso(now - 600_000), beat: iso(now - 5_000), step: 'GF94 녹음', line: '## N03 일치 0.97', pid: 42 }));
  fs.writeFileSync(path.join(dir, 'B.json'), JSON.stringify({ beat: iso(now - STALE_MS - 1_000) }));
  fs.writeFileSync(path.join(dir, 'C.json'), '{깨짐');
  const a = readBeat(path.join(dir, 'A.json'), now);
  assert.equal(a.phase, '실행');
  assert.equal(a.external, true);
  assert.equal(a.step, 'GF94 녹음');
  assert.equal(a.lastText, '## N03 일치 0.97');
  assert.equal(a.pid, 42);
  assert.equal(readBeat(path.join(dir, 'B.json'), now), null);
  assert.equal(readBeat(path.join(dir, 'C.json'), now), null);
  assert.equal(readBeat(path.join(dir, '없음.json'), now), null);
});

test('바깥 일: 단계가 바뀔 때만 알리고, 중지는 멈춤 파일을 만든다', () => {
  const dir = tmp();
  const events = [];
  const ext = createExternal({ dir, emit: (e, d) => events.push([e, d]), poll: 0 });
  const stop = path.join(dir, 'stop.flag');
  const write = (step) => fs.writeFileSync(path.join(dir, 'W-1.json'), JSON.stringify({ beat: iso(Date.now()), step, pid: 7, stop }));
  write('GF94 녹음');
  ext.scan(); ext.scan();
  write('GF95 녹음');
  ext.scan();
  assert.deepEqual(events, [['runtime', { id: 'W-1', phase: '실행' }], ['runtime', { id: 'W-1', phase: '실행' }]]);
  assert.deepEqual(ext.sessions().map((s) => [s.id, s.pid]), [['W-1', 7]]);
  assert.equal(ext.stop('W-1'), true);
  assert.ok(fs.existsSync(stop));
  assert.equal(ext.stop('W-없음'), false);
  fs.rmSync(path.join(dir, 'W-1.json'));
  ext.scan();
  assert.deepEqual(events.at(-1), ['runtime', { id: 'W-1', phase: null }]);
  ext.close();
});

test('바깥 일: 진행률 — %·빠르기·남은 시간, 멈춤 의심, 끝 신호', async () => {
  const { progressOf, STALL_MS } = await import('../lib/external.mjs');
  const now = Date.parse('2026-11-01T12:10:00Z');
  // 최근 표본 두 개로 빠르기: 60초에 120줄 → 2줄/초, 남은 600줄 → 300초
  const p = progressOf({ done: 200, total: 800, unit: '줄' }, { now, beat: now, startedAt: now - 3_600_000, hist: [[now - 60_000, 80], [now, 200]] });
  assert.equal(Math.round(p.pct), 25);
  assert.equal(p.rate, 2);
  assert.equal(p.eta, 300);
  // 표본이 없으면 시작부터 평균, 일이 준 eta가 있으면 그것
  assert.equal(progressOf({ done: 50, total: 100 }, { now, beat: now, startedAt: now - 50_000 }).eta, 50);
  assert.equal(progressOf({ done: 50, total: 100, eta: 7 }, { now, beat: now, startedAt: now - 50_000 }).eta, 7);
  assert.equal(progressOf({ step: 'x' }, { now, beat: now, startedAt: now }), null);
  // total 없이 센 수만
  assert.equal(progressOf({ done: 3 }, { now, beat: now, startedAt: now - 3000 }).pct, null);

  const dir = tmp();
  const t = Date.now();
  fs.writeFileSync(path.join(dir, 'S.json'), JSON.stringify({ beat: iso(t - STALL_MS - 5_000), done: 1, total: 2 }));
  fs.writeFileSync(path.join(dir, 'F.json'), JSON.stringify({ beat: iso(t), finished: true }));
  assert.equal(readBeat(path.join(dir, 'S.json'), t).stalled, true);
  assert.equal(readBeat(path.join(dir, 'F.json'), t), null);
});

test('ffmpeg 진행률: -progress 묶음 읽기, 사용자 규칙(-threads 10) 넣기', async () => {
  const { parseProgress, withRules } = await import('../scripts/ffprog.mjs');
  const p = parseProgress('frame=240\nfps=120.5\nout_time_us=10000000\nout_time_ms=10000000\nspeed=2.5x\nprogress=continue');
  assert.deepEqual([p.sec, p.speed, p.fps, p.frame, p.end], [10, 2.5, 120.5, 240, false]);
  assert.equal(parseProgress('out_time_us=N/A\nprogress=end').end, true);
  assert.deepEqual(withRules(['-i', 'a.mp4', 'b.mp4']), ['-progress', 'pipe:1', '-nostats', '-i', 'a.mp4', '-threads', '10', 'b.mp4']);
  assert.deepEqual(withRules(['-i', 'a.mp4', '-threads', '4', 'b.mp4']).slice(3), ['-i', 'a.mp4', '-threads', '4', 'b.mp4']);
});
