// 기억 기록 읽기(주인말·검수·세션지시 → 항목)와 결과 칸 머리말 정리
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMemory, memoryDays } from '../lib/memlog.mjs';
import { createStore, demoteHeadings, resultText } from '../lib/store.mjs';
import { resultOf } from '../lib/sessions.mjs';

const OWNER = `# 주인 말 · 2026-11-18

사람이 화면에서 한 말.

## 기록
- 09:46 **질문** 정리가 필요한듯 → 근거 [[W-261103-004]] [[CLAUDE]]
- 09:47 **지시** [[W-261118-001]] 비서실 — 기억 탭을 보기 좋게
- 10:09 **지금 실행** [[W-261103-004]] → [[W-261116-002]]
`;

test('주인말 줄: 시각·종류·가리키는 작업·나머지 말·링크', () => {
  const e = parseMemory(OWNER, { source: '주인말', date: '2026-11-18' });
  assert.equal(e.length, 3);
  assert.deepEqual({ ...e[0] }, { date: '2026-11-18', time: '09:46', source: '주인말', name: null, kind: '질문', task: null, group: null, text: '정리가 필요한듯 → 근거 [[W-261103-004]] [[CLAUDE]]', links: ['W-261103-004', 'CLAUDE'] });
  assert.equal(e[1].task, 'W-261118-001');
  assert.equal(e[1].text, '비서실 — 기억 탭을 보기 좋게');
  assert.equal(e[2].task, 'W-261103-004');
  assert.deepEqual(e[2].links, ['W-261103-004', 'W-261116-002']);
});

test('세션지시: ### 머리의 작업이 아래 줄들의 작업', () => {
  const body = '## 기록\n\n### [[W-261102-005]] 볼륨 책정 (기획실 / 신작게임)\n\n- 9:13 메뉴를 합친다\n- 09:19 게시하기\n\n### [[W-261103-002]] 애널리틱스\n\n- 10:06 다시 시작해줘\n';
  const e = parseMemory(body, { source: '세션지시', date: '2026-11-03' });
  assert.deepEqual(e.map((x) => [x.time, x.task, x.kind]), [['09:13', 'W-261102-005', '세션 지시'], ['09:19', 'W-261102-005', '세션 지시'], ['10:06', 'W-261103-002', '세션 지시']]);
  assert.equal(e[0].group, '볼륨 책정 (기획실 / 신작게임)');
});

test('memoryDays: 기억 폴더의 기억 문서만, 최근 날짜부터, 같은 날은 늦은 시각부터', () => {
  const files = [
    { rel: '기억/주인말-2026-11-18.md', name: '주인말-2026-11-18', data: { type: '주인말', date: '2026-11-18' }, body: OWNER },
    { rel: '기억/검수-2026-11-18.md', name: '검수-2026-11-18', data: { type: '검수판정', date: '2026-11-18' }, body: '## 기록\n- 09:50 **완료** [[W-261116-001]] 주간 스킬 (검수 → 확인)\n' },
    { rel: '기억/주인말-2026-11-16.md', name: '주인말-2026-11-16', data: { type: '주인말', date: '2026-11-16' }, body: '## 기록\n- 10:09 **일정 완료** 슬랙 · 무엇\n' },
    { rel: '작업/W-261118-001.md', name: 'W-261118-001', data: { type: '작업' }, body: '- 09:00 무시' },
  ];
  const days = memoryDays(files);
  assert.deepEqual(days.map((d) => d.date), ['2026-11-18', '2026-11-16']);
  assert.deepEqual(days[0].entries.map((e) => e.time), ['10:09', '09:50', '09:47', '09:46']);
  assert.equal(days[0].entries[1].source, '검수판정');
  assert.equal(memoryDays(files, { days: 1 }).length, 1);
  assert.deepEqual(memoryDays(files, { name: '검수-2026-11-18' })[0].entries.map((e) => e.kind), ['완료']);
});

test('demoteHeadings: 가장 큰 머리말이 ###가 되게 같은 만큼 내린다 (코드 블록 안은 그대로)', () => {
  assert.equal(demoteHeadings('## 제목\n본문\n### 작은\n```\n## 코드\n```'), '### 제목\n본문\n#### 작은\n```\n## 코드\n```');
  assert.equal(demoteHeadings('### 이미 작음\n#### 더'), '### 이미 작음\n#### 더');
  assert.equal(demoteHeadings('머리말 없음 #태그'), '머리말 없음 #태그');
});

test('resultText: 요약 + "### 결과물"에 경로·보고서', () => {
  assert.equal(resultText('## 끝\n확인할 점', ['C:\\a\\b.md'], ['R-261118-001']), '### 끝\n확인할 점\n\n### 결과물\n\n- `C:\\a\\b.md`\n- [[R-261118-001]]');
  assert.equal(resultText('끝'), '끝');
});

test('결과 칸: 예전 결과 안의 "## 제목"에서 끊기지 않고 통째로 바뀐다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-mem-'));
  fs.mkdirSync(path.join(root, '작업'), { recursive: true });
  const rel = path.join(root, '작업', 'W-261118-001.md');
  fs.writeFileSync(rel, '---\ntype: 작업\nid: W-261118-001\ntitle: 시험\ndept: 비서실\nstatus: 실행중\ncreated: 2026-11-18T09:00\nupdated: 2026-11-18T09:00\n---\n## 지시\n\n하기\n\n## 진행 로그\n\n- 09:00 시작\n\n## 결과\n\n## 옛 제목\n\n옛 내용\n');
  const store = createStore(root, { now: () => new Date('2026-11-18T10:00:00+09:00') });
  await store.setResult('W-261118-001', '## 새 제목\n새 내용');
  const body = fs.readFileSync(rel, 'utf8');
  assert.doesNotMatch(body, /옛/);
  assert.match(body, /## 결과\n\n### 새 제목\n새 내용\n/);
  assert.equal(resultOf(body), '### 새 제목\n새 내용');
  // 예전 형식(결과 안에 ##)도 결과 전체를 읽는다
  assert.equal(resultOf('## 지시\n\n하기\n\n## 결과\n\n## 옛 제목\n\n옛 내용\n'), '## 옛 제목\n\n옛 내용');
});
