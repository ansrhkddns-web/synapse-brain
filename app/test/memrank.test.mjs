// 기억 정리: 층·출처·무게 매기기와 사람이 고친 분류
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rankMemory, resultOf, substance, readMarks, writeMark, sizeLabel } from '../lib/memrank.mjs';

const now = new Date('2026-11-18T12:00');
const f = (rel, data, body = '') => ({ rel, name: path.basename(rel, '.md'), data, body });
const task = (id, extra = {}, result = '') => f(`작업/${id}.md`, { type: '작업', id, title: id, dept: '개발실', status: '완료', created: '2026-11-17T09:00', updated: '2026-11-17T10:00', session: null, schedule: null, parent: null, decision: null, tags: [], ...extra },
  `## 지시\n\n한다\n\n## 진행 로그\n\n- 09:00 작업 생성\n\n## 결과\n\n${result}`);
const long = '결과를 자세히 적었다. '.repeat(40);

test('결과 칸과 읽을 만한 글자 수 — 경로 줄·링크 괄호·머리말 기호는 세지 않는다', () => {
  const body = '## 지시\n\n가\n\n## 결과\n\n### 요약\n본문 [[W-1]] 끝\n- C:\\Work\\x.md\n\n## 진행 로그\n- 1';
  assert.equal(resultOf(body), '### 요약\n본문 [[W-1]] 끝\n- C:\\Work\\x.md');
  assert.equal(substance(resultOf(body)), '요약본문W1끝'.length);
  assert.equal(sizeLabel(10), '짧음');
  assert.equal(sizeLabel(6000), '아주 긺');
});

test('층과 출처: 카드·규칙은 기준, 결정은 결과, 결과 없는 작업과 기록 파일은 흔적, 바깥 세션은 따라 적음', () => {
  const files = [
    f('기억/카드/K-1.md', { type: '기억카드', id: 'K-1', rule: '먼저 확인한다', status: '사용', created: '2026-11-04T09:00' }),
    f('CLAUDE.md', {}, '# 규칙\n'),
    f('결정/D-1.md', { type: '결정', id: 'D-1', title: '고를까요?', status: '결정됨', kind: '선택', created: '2026-11-17T09:00' }),
    f('결정/D-2.md', { type: '결정', id: 'D-2', title: '기억할까요?', status: '결정됨', kind: '기억', created: '2026-11-17T09:00' }),
    task('W-1', { session: 'abc' }, long),
    task('W-2', { tags: ['바깥세션', '자동이름'] }),
    task('W-3', { status: '실행중' }),
    task('W-4', { status: '취소' }, long),
    f('기억/주인말-2026-11-17.md', { type: '주인말', date: '2026-11-17' }, '## 기록\n- 09:00 **지시** [[W-1]] 개발실 — 해 줘\n- 09:05 **지시** [[W-1]] 개발실 — 더 해 줘'),
    f('기억/검수-2026-11-17.md', { type: '검수판정', date: '2026-11-17' }, '## 기록\n- 10:00 **다시 열기** [[W-1]] 다시'),
  ];
  const r = rankMemory(files, { now });
  const by = Object.fromEntries(r.items.map((x) => [x.id, x]));
  assert.equal(by['K-1'].layer, '기준'); assert.equal(by['K-1'].origin, '내가 승인');
  assert.equal(by.CLAUDE.layer, '기준'); assert.equal(by.CLAUDE.origin, '규칙');
  assert.equal(by['D-1'].layer, '결과'); assert.equal(by['D-1'].origin, '내가 결정');
  assert.equal(by['D-2'].layer, '흔적');                     // 카드 승인 기록 — 본체는 카드
  assert.equal(by['W-1'].layer, '결과'); assert.equal(by['W-1'].origin, '내가 시킴');
  assert.equal(by['W-1'].said, 2);
  assert.ok(by['W-1'].reasons.some((x) => /2번 말함/.test(x.why)));
  assert.ok(by['W-1'].reasons.some((x) => /다시 엶/.test(x.why)));
  assert.equal(by['W-2'].layer, '흔적'); assert.equal(by['W-2'].origin, '따라 적음');
  assert.equal(by['W-3'].layer, '지금');
  assert.equal(by['W-4'].layer, '흔적');
  assert.equal(by['주인말-2026-11-17'].origin, '내가 말함');
  assert.equal(by['검수-2026-11-17'].origin, '자동 기록');
  // 무게: 내가 시키고 여러 번 말한 결과 > 따라 적기만 한 빈 작업
  assert.ok(by['W-1'].score > by['W-2'].score);
  // 무게 = 까닭의 합 (0~100 안)
  for (const x of r.items) assert.equal(x.score, Math.max(0, Math.min(100, x.reasons.reduce((a, y) => a + y.n, 0))), x.id);
  assert.equal(r.totals.layer['기준'], 2);
  // 무게순 정렬
  assert.deepEqual(r.items.map((x) => x.score), [...r.items.map((x) => x.score)].sort((a, b) => b - a));
});

test('사람이 고친 분류: 핵심 고정은 무게 80 이상, 흔적 내리기는 흔적 층 · 파일에 남고 지울 수 있다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-rank-'));
  const files = [task('W-1', { status: '취소' }), task('W-2', {}, long)];
  writeMark(root, 'W-1', '핵심', { now });
  writeMark(root, 'W-2', '흔적', { now });
  let r = rankMemory(files, { now, marks: readMarks(root) });
  const by = (id) => r.items.find((x) => x.id === id);
  assert.ok(by('W-1').score >= 80); assert.equal(by('W-1').mark, '핵심');
  assert.equal(by('W-1').layer, '결과');                     // 흔적이던 것도 필요한 것으로 올라온다
  assert.equal(by('W-2').layer, '흔적'); assert.ok(by('W-2').score <= 10);
  writeMark(root, 'W-1', null);
  r = rankMemory(files, { now, marks: readMarks(root) });
  assert.equal(by('W-1').mark, null);
  assert.deepEqual(Object.keys(readMarks(root)), ['W-2']);
});

test('바깥 세션의 결과 칸이 "마지막 답" 꼬리표뿐이면 결과가 아니라 흔적 (두 꼬리표 모두)', () => {
  const tail1 = `${long}\n\n> 대화 기록의 마지막 답. 이어서 일하면 다시 실행중이 된다.`;
  const tail2 = `${long}\n\n> 턴이 끝난 때의 마지막 답. 이어서 일하면 다시 실행중이 된다.`;
  const r = rankMemory([task('W-1', { tags: ['바깥세션'] }, tail1), task('W-2', { tags: ['바깥세션'] }, tail2), task('W-3', { tags: ['바깥세션'] }, long)], { now });
  const by = Object.fromEntries(r.items.map((x) => [x.id, x]));
  assert.equal(by['W-1'].layer, '흔적');
  assert.equal(by['W-2'].layer, '흔적');
  assert.equal(by['W-3'].layer, '결과');                     // 꼬리표 없이 정리된 결과는 그대로
});
