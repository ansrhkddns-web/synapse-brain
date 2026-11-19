import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadVault, checkVault } from '../lib/vault.mjs';

const DEPT = (name) => `---\ntype: 부서\nname: ${name}\nworkdir: ${os.tmpdir().replace(/\\/g, '/')}\n---\n# ${name}\n`;

const TASK = ({ id = 'W-261030-001', status = '실행중', extra = '', created = '2026-10-30T07:00' } = {}) => `---
type: 작업
id: ${id}
title: 아침 AI 트렌드
dept: 리서치부
status: ${status}
created: ${created}
updated: 2026-10-30T07:10
session: null
schedule: null
parent: null
${extra}tags: []
---
## 지시

트렌드 정리

## 진행 로그

- 07:00 시작

## 결과
`;

const DECISION = ({ status = '대기', choice = 'null', task = 'W-261030-001' } = {}) => `---
type: 결정
id: D-261030-001
title: 보고서 범위
task: "[[${task}]]"
dept: 리서치부
status: ${status}
created: 2026-10-30T07:20
options:
  - 영상 도구만
  - 전체
recommended: 1
choice: ${choice}
note: null
---
## 배경
`;

function makeVault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  const all = { '부서/리서치부/규칙.md': DEPT('리서치부'), ...files };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return checkVault(loadVault(root));
}

test('올바른 작업 + 결정대기 + 결정은 통과', () => {
  const r = makeVault({
    '작업/W-261030-001.md': TASK({ status: '결정대기', extra: 'decision: "[[D-261030-001]]"\n' }),
    '결정/D-261030-001.md': DECISION(),
    '일지/2026-10-30.md': '---\ntype: 일지\ndate: 2026-10-30\n---\n- [[W-261030-001]] 진행\n',
  });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('실제 보관함은 오류 없이 통과', () => {
  const root = path.join(import.meta.dirname, '..', '..', 'vault');
  const r = checkVault(loadVault(root));
  assert.deepEqual(r.errors, []);
});

const BAD = [
  ['파일 이름과 id가 다름', { '작업/W-261030-002.md': TASK() }, /id\(W-261030-001\)가 파일 이름과 다름/],
  ['없는 상태', { '작업/W-261030-001.md': TASK({ status: '진행' }) }, /status "진행"/],
  ['ID 날짜와 created가 다름', { '작업/W-261030-001.md': TASK({ created: '2026-10-29T07:00' }) }, /ID 날짜/],
  ['결정대기인데 decision 없음', { '작업/W-261030-001.md': TASK({ status: '결정대기' }) }, /decision 링크가 없음/],
  ['대기예약인데 schedule 없음', { '작업/W-261030-001.md': TASK({ status: '대기예약' }) }, /schedule이 없음/],
  ['모르는 칸', { '작업/W-261030-001.md': TASK({ extra: 'owner: 나\n' }) }, /모르는 칸 "owner"/],
  ['결정됨인데 choice 없음', { '작업/W-261030-001.md': TASK(), '결정/D-261030-001.md': DECISION({ status: '결정됨' }) }, /choice가 없음/],
  ['choice 범위 밖', { '작업/W-261030-001.md': TASK(), '결정/D-261030-001.md': DECISION({ status: '결정됨', choice: '3' }) }, /choice는 1~2/],
  ['결정이 없는 작업을 가리킴', { '결정/D-261030-001.md': DECISION({ task: 'W-261030-009' }) }, /W-261030-009가 없음/],
  ['frontmatter 없음', { '작업/W-261030-001.md': '# 제목만\n' }, /frontmatter가 없음/],
  ['폴더가 틀림', { '보고서/W-261030-001.md': TASK() }, /작업\/ 폴더에 있어야 함/],
  ['본문 제목 빠짐', { '작업/W-261030-001.md': TASK().replace('## 결과\n', '') }, /"## 결과" 제목이 없음/],
];

for (const [name, files, pattern] of BAD) {
  test(`잡아내야 함: ${name}`, () => {
    const r = makeVault(files);
    assert.ok(r.errors.some((e) => pattern.test(e)), `오류 목록: ${JSON.stringify(r.errors)}`);
  });
}

test('본문의 깨진 링크는 경고만', () => {
  const r = makeVault({ '일지/2026-10-30.md': '---\ntype: 일지\ndate: 2026-10-30\n---\n[[없는파일]]\n' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
});
