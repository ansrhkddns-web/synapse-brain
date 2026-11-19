// 바깥 일 신호 남기기 (lib/external.mjs 규약) — 어떤 일이든 단계·진행률을 두뇌 화면에 띄운다.
//   node beat.mjs <작업 id> [--step 이름] [--line 한 줄] [--done N] [--total N] [--unit 줄] [--eta 초] [--pid N] [--stop 경로] [--finish]
// 부를 때마다 app/external/<id>.json 에 합쳐 쓰고 beat를 지금으로. 처음이면 startedAt도. --finish면 끝(화면에서 내려감).
// 파이썬에서는 scripts/brainbeat.py 의 beat(id, step=…, done=…, total=…).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTERNAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'external');
const ID = /^[A-Za-z0-9가-힣_.-]{1,80}$/;

export function writeBeat(id, patch, dir = EXTERNAL) {
  if (!ID.test(id)) throw new Error(`작업 id 형식이 아님: ${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { /* 처음 */ }
  const now = new Date().toISOString();
  // 끝난 신호 위에 새로 시작하면 처음부터
  if (cur.finished && !patch.finished) cur = {};
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), beat: now };
  next.startedAt ??= now;
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next));
  fs.renameSync(`${file}.tmp`, file);
  return next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [id, ...rest] = process.argv.slice(2);
  if (!id) { console.error('쓰는 법: node beat.mjs <작업 id> [--step …] [--done N --total N --unit …] [--line …] [--finish]'); process.exit(2); }
  const arg = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
  const n = (v) => (v === undefined ? undefined : Number(v));
  writeBeat(id, {
    step: arg('step'), line: arg('line'), unit: arg('unit'), stop: arg('stop'),
    done: n(arg('done')), total: n(arg('total')), eta: n(arg('eta')), pid: n(arg('pid')),
    finished: rest.includes('--finish') ? true : undefined,
  });
}
