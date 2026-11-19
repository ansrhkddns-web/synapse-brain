// 4단계: 문서 대조(산출물 확인) · Claude 사용량(토큰) · 알림(새로 생긴 것만)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exists, verify } from '../lib/checks.mjs';
import { createTokens, usageOf } from '../lib/tokens.mjs';
import { createNotifier } from '../lib/notify.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('문서 대조: 경로·* 조각·비어 있지 않은 폴더, 앞서 간 단계와 빠진 단계', () => {
  const root = tmp('brain-chk-');
  const film = path.join(root, 'cache', 'movie_a');
  fs.mkdirSync(path.join(film, 'source'), { recursive: true });
  fs.writeFileSync(path.join(film, 'source', 'a.mp4'), 'x');
  fs.mkdirSync(path.join(film, 'tts'), { recursive: true });   // 빈 폴더 = 아직
  fs.writeFileSync(path.join(film, 'script.json'), '{}');
  fs.mkdirSync(path.join(root, 'out', 'movie_a-'), { recursive: true });
  fs.writeFileSync(path.join(root, 'out', 'movie_a-', 'final.mp4'), 'x');

  assert.equal(exists(`${film}\\source\\`), true);
  assert.equal(exists(`${film}\\tts\\`), false);
  assert.equal(exists(`${root}\\out\\movie_a*\\*.mp4`), true);
  assert.equal(exists(`${root}\\out\\movie_b*\\*.mp4`), false);

  const p = {
    id: 'p', slug: 'movie_a', workdir: path.join(root, 'cache'), stages: ['원본', '대본', '확인', '나레이션', '렌더'], stage: '확인',
    steps: { 원본: { check: '{workdir}\\{slug}\\source\\' }, 대본: { check: ['{workdir}\\{slug}\\script.json', '{workdir}\\{slug}\\없음.md'] }, 나레이션: { check: '{workdir}\\{slug}\\tts\\' }, 렌더: { check: `${root}\\out\\{slug}*\\*.mp4` } },
  };
  const v = verify(p, { fresh: true });
  assert.deepEqual(v.stages, { 원본: true, 대본: false, 확인: null, 나레이션: false, 렌더: true });
  assert.equal(v.ahead, '렌더');          // 문서는 확인인데 렌더 결과가 이미 있다
  assert.deepEqual(v.missing, ['대본']);  // 지난 단계인데 산출물이 모자란다
});

test('사용량: 같은 응답은 한 번만, 오늘·5시간 창·세션별', () => {
  const dir = tmp('brain-tok-');
  const proj = path.join(dir, 'D--x');
  fs.mkdirSync(proj);
  const now = Date.now();
  const line = (id, t, sess, out) => JSON.stringify({ type: 'assistant', sessionId: sess, requestId: `r${id}`, timestamp: new Date(t).toISOString(), message: { id: `m${id}`, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: out, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } } });
  fs.writeFileSync(path.join(proj, 'a.jsonl'), [line(1, now - 60_000, 'A', 5), line(1, now - 60_000, 'A', 5), line(2, now - 6 * 3600_000, 'A', 7), '{"type":"user"}', line(3, now - 1000, 'B', 9)].join('\n') + '\n');
  assert.equal(usageOf('{"type":"user"}'), null);
  const tk = createTokens({ projectsDir: dir, now: () => now });
  const s = tk.snapshot();
  const today = new Date(now).getHours() >= 6 ? 3 : null;   // 6시간 전 응답이 오늘인지는 지금 시각에 달렸다
  if (today) assert.equal(s.today.calls, 3);
  assert.equal(s.window.calls, 2);
  assert.equal(s.window.output, 14);
  assert.equal(s.window.total, 2 * 111 + 14);
  // 파일이 자라면 늘어난 만큼만 이어 읽는다
  fs.appendFileSync(path.join(proj, 'a.jsonl'), line(4, now, 'B', 1) + '\n');
  const s2 = createTokens({ projectsDir: dir, now: () => now }).snapshot();
  assert.equal(s2.window.calls, 3);
  assert.deepEqual(s2.sessions.find((x) => x.id === 'B').calls, 2);
});

test('알림: 처음 목록은 조용히, 새로 생긴 것만, 꺼 둔 종류는 빼고, 많으면 하나로', async () => {
  const dir = tmp('brain-ntf-');
  const file = path.join(dir, 'notify.json');
  let list = [{ key: '결정:1', kind: '결정', title: '첫 결정' }];
  const sent = [];
  const n = createNotifier({ file, items: () => list, poll: 0, send: async (title, body) => { sent.push(title); return true; } });
  assert.deepEqual(await n.tick(), []);
  list = [...list, { key: '승인:a', kind: '승인', title: '대본' }, { key: '입력:s', kind: '입력대기', title: '세션' }];
  const b = await n.tick();
  assert.deepEqual(b.map((x) => x.key), ['승인:a']);   // 입력대기는 기본 꺼짐
  assert.deepEqual(sent, ['[승인] 대본']);
  assert.deepEqual(await n.tick(), []);                  // 같은 것은 다시 안 알린다
  list = Array.from({ length: 6 }, (_, i) => ({ key: `검수:${i}`, kind: '검수', title: `작업 ${i}` }));
  const many = await n.tick();
  assert.equal(many.length, 1);
  assert.match(sent.at(-1), /확인할 일 6개/);
  fs.writeFileSync(file, JSON.stringify({ kinds: ['결정'] }));
  list = [...list, { key: '실패:x', kind: '실패', title: 'x' }];
  assert.deepEqual(await n.tick(), []);
  assert.equal(n.status().history.length, 2);
});
