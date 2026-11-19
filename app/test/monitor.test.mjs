import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../lib/monitor.mjs';

const GB = 1024 ** 3;

test('사용량: 세션 프로세스 나무는 작업 몫, 나머지는 이름으로 묶는다', () => {
  const sample = {
    at: 1,
    gpu: { name: 'GPU', util: 50, temp: 40, memUsed: 4 * GB, memTotal: 10 * GB },
    procs: [
      { pid: 10, ppid: 1, name: 'node.exe', cpu: 4, mem: 0.1 * GB, gpu: 0, vram: 0 },        // 서버
      { pid: 20, ppid: 10, name: 'claude.exe', cpu: 8, mem: 0.4 * GB, gpu: 0, vram: 0 },     // 작업 세션
      { pid: 21, ppid: 20, name: 'ffmpeg.exe', cpu: 200, mem: 1 * GB, gpu: 30, vram: 2 * GB }, // 세션이 띄운 자식
      { pid: 30, ppid: 10, name: 'claude.exe', cpu: 2, mem: 0.2 * GB, gpu: 0, vram: 0 },     // 기억 질문 (서버 몫)
      { pid: 40, ppid: 1, name: 'chrome.exe', cpu: 10, mem: 1 * GB, gpu: 1, vram: 0 },
      { pid: 41, ppid: 40, name: 'chrome.exe', cpu: 10, mem: 1 * GB, gpu: 0, vram: 0 },
      { pid: 50, ppid: 1, name: 'Idle', cpu: 1500, mem: 0, gpu: 0, vram: 0 },
    ],
  };
  const u = summarize(sample, { sessions: [{ id: 'W-261031-001', pid: 20 }], serverPid: 10, cores: 20, ram: { used: 8 * GB, total: 32 * GB, pct: 25 }, cpu: 30 });
  assert.equal(u.tasks.length, 1);
  const t = u.tasks[0];
  assert.equal(t.count, 2);
  assert.deepEqual(t.procs, ['claude', 'ffmpeg']);
  assert.equal(t.cpu, 10.4);          // (8 + 200) / 20코어
  assert.equal(t.vramPct, 20);        // 2GB / 10GB
  assert.equal(t.gpu, 30);
  assert.equal(u.server.count, 2);    // node + 기억 질문 claude (세션 나무는 빠짐)
  assert.equal(u.top[0].name, 'chrome');
  assert.equal(u.top[0].count, 2);
  assert.ok(!u.top.some((p) => p.name === 'Idle'));
  assert.equal(u.gpu.memPct, 40);
});

test('사용량: 표본이 없으면 빈 목록', () => {
  const u = summarize(null, { cores: 4, ram: { used: 1, total: 2, pct: 50 }, cpu: 0 });
  assert.deepEqual(u.tasks, []);
  assert.deepEqual(u.top, []);
  assert.equal(u.gpu, null);
});
