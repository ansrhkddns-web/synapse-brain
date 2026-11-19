// 공정 실행기: 단계 실행 → 끝 → 승인 대기 → 승인 → 다음 단계(auto) · 명령 단계 · 그룹 대기열 · 멈추기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createPipeline, fill, stepOf } from '../lib/pipeline.mjs';
import { linkTarget, loadVault, checkVault } from '../lib/vault.mjs';

const REAL_VAULT = path.join(import.meta.dirname, '..', '..', 'vault');

function vault(procs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-pipe-'));
  for (const rel of ['CLAUDE.md', '부서/리서치부/규칙.md', '템플릿/작업.md']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REAL_VAULT, rel), path.join(root, rel));
  }
  const f = path.join(root, '부서/리서치부/규칙.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^workdir: .*$/m, `workdir: ${root.replace(/\\/g, '/')}`));
  fs.mkdirSync(path.join(root, '부서/리서치부/하위'), { recursive: true });
  fs.writeFileSync(path.join(root, '부서/리서치부/하위/영화.md'), '---\ntype: 하위\nname: 영화\ndept: 리서치부\n---\n');
  fs.mkdirSync(path.join(root, '부서/리서치부/공정'), { recursive: true });
  for (const [name, yaml] of Object.entries(procs)) fs.writeFileSync(path.join(root, `부서/리서치부/공정/${name}.md`), `---\ntype: 공정\nname: ${name}\ndept: 리서치부\nunit: 영화\nstatus: 정지\n${yaml}---\n본문\n`);
  return root;
}
const fakeRunner = () => { const r = { started: [], stopped: [], start: (id) => r.started.push(id), stop: (id) => { r.stopped.push(id); return true; } }; return r; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('공정: 세션 단계 → 승인 대기 → 승인하면 다음 단계를 바로(auto), 사람 단계는 넘기기, 마지막이면 끝', async () => {
  const root = vault({ 리뷰: `title: 영화리뷰 제작\nstages: [대본, 확인, 나레이션]\nauto: true\nitem: 영혼의 카니발\nsteps:\n  대본: { do: "대본을 쓴다", gate: true }\n  나레이션: { do: "나레이션을 녹음한다" }\n` });
  const store = createStore(root);
  const runner = fakeRunner();
  const pipe = createPipeline({ store, runner, externalDir: path.join(root, 'ext'), poll: 0 });
  const proc = () => store.processes().find((p) => p.id === '리뷰');

  const { task } = await pipe.run('리뷰');
  assert.deepEqual(runner.started, [task]);
  assert.equal(proc().phase, '실행');
  assert.equal(proc().status, '가동');
  assert.equal(linkTarget(proc().run), task);
  const t = store.readTask(task);
  assert.equal(t.data.unit, '영화');
  assert.match(t.body, /1\/3단계 "대본" — 작업물: 영혼의 카니발/);
  assert.match(t.body, /대본을 쓴다/);
  await assert.rejects(pipe.run('리뷰'), /이미 돌고/);

  // 세션이 결과 보고(검수) → gate라 승인 대기
  await store.patchTask(task, { status: '검수' });
  pipe.check(); await wait(50);
  assert.equal(proc().phase, '승인대기');
  assert.equal(proc().stage, '대본');

  // 승인 → "확인"은 정의 없는 사람 단계라 거기서 대기
  await pipe.approve('리뷰', '좋음');
  assert.equal(proc().stage, '확인');
  assert.equal(proc().phase, '대기');
  await assert.rejects(pipe.run('리뷰'), /사람 단계/);

  // 사람이 하고 넘김 → 나레이션은 정의가 있고 auto라 바로 실행
  await pipe.advance('리뷰');
  assert.equal(proc().stage, '나레이션');
  assert.equal(proc().phase, '실행');
  assert.equal(runner.started.length, 2);
  await store.patchTask(runner.started[1], { status: '검수' });
  pipe.check(); await wait(50);
  assert.equal(proc().phase, '끝');
  assert.equal(proc().status, '정지');

  // 새 작업물로 처음부터
  await pipe.startItem('리뷰', '눈 감지 마');
  assert.deepEqual([proc().item, proc().stage, proc().phase], ['눈 감지 마', '대본', '대기']);
  assert.deepEqual(checkVault(loadVault(root)).errors, []);
});

test('공정: 명령 단계는 작업 폴더에서 돌고 0으로 끝나면 다음, 실패면 실패 → 다시', async () => {
  const root = vault({ 렌더: `title: 렌더\nstages: [굽기, 올리기]\nitem: a\nsteps:\n  굽기: { cmd: "echo 굽는중 {item} && exit %CODE%", group: 렌더 }\n  올리기: { cmd: "echo up" }\n` });
  const store = createStore(root);
  const pipe = createPipeline({ store, runner: fakeRunner(), externalDir: path.join(root, 'ext'), poll: 0 });
  const proc = () => store.processes().find((p) => p.id === '렌더');
  const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await wait(50); };

  process.env.CODE = '3';
  const { task } = await pipe.run('렌더');
  await until(() => proc().phase === '실패');
  assert.equal(proc().phase, '실패');
  assert.match(store.readTask(task).body, /명령 실패 \(종료 코드 3\)/);
  assert.equal(store.readTask(task).data.status, '검수');

  process.env.CODE = '0';
  await pipe.retry('렌더');
  await until(() => proc().stage === '올리기');
  assert.equal(proc().stage, '올리기');
  assert.equal(proc().phase, '대기');   // auto가 아니라 다음 단계에서 기다린다
  delete process.env.CODE;
});

test('공정: 같은 그룹은 하나씩 — 둘째는 대기열, 첫째를 멈추면 둘째가 돈다', async () => {
  const def = (n) => `title: ${n}\nstages: [굽기]\nitem: x\nsteps:\n  굽기: { do: "굽기", group: 렌더 }\n`;
  const root = vault({ A: def('A'), B: def('B') });
  const store = createStore(root);
  const runner = fakeRunner();
  const pipe = createPipeline({ store, runner, externalDir: path.join(root, 'ext'), poll: 0 });
  const ph = (id) => store.processes().find((p) => p.id === id).phase;
  await pipe.run('A');
  await pipe.run('B');
  assert.deepEqual([ph('A'), ph('B')], ['실행', '대기열']);
  assert.deepEqual(pipe.view().queue, ['B']);
  await pipe.stop('A');
  await wait(50);
  assert.equal(ph('A'), '대기');
  assert.equal(ph('B'), '실행');
  assert.equal(runner.stopped.length, 1);
  assert.equal(runner.started.length, 2);
});

test('공정: 정의 읽기·자리 바꿔 넣기', () => {
  const p = { stages: ['a', 'b'], stage: 'b', steps: { b: { cmd: 'x {item}', gate: true, group: 'LLM' } } };
  assert.deepEqual(stepOf(p), { stage: 'b', kind: 'cmd', text: 'x {item}', gate: true, group: 'LLM' });
  assert.equal(stepOf(p, 'a'), null);
  assert.equal(fill('{scripts}\\ffprog.mjs {task} "{item}"', { scripts: 'S', task: 'W-1', item: '영화' }), 'S\\ffprog.mjs W-1 "영화"');
});
