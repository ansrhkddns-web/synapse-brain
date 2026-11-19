// 세무달력: 반복 규칙 → 날짜, 토·일·공휴일이면 다음 평일, 끝냄 표시
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCalendar, createTaxCal, datesOf, shift } from '../lib/taxcal.mjs';

const d = (s) => new Date(`${s}T00:00`);
const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

test('세무달력: 매월·말일·매년·날짜, 휴일 미루기', () => {
  assert.deepEqual(datesOf({ 매월: 10 }, d('2026-11-01'), d('2027-01-31')).map(ymd), ['2026-11-10', '2026-12-10', '2027-01-10']);
  assert.deepEqual(datesOf({ 매월: '말일' }, d('2027-01-01'), d('2027-03-31')).map(ymd), ['2027-01-31', '2027-02-28', '2027-03-31']);
  assert.deepEqual(datesOf({ 매년: ['01-25', '07-25'] }, d('2026-11-01'), d('2027-12-31')).map(ymd), ['2027-01-25', '2027-07-25']);
  assert.deepEqual(datesOf({ 매월: 10, 달: [1, 7] }, d('2026-11-01'), d('2027-12-31')).map(ymd), ['2027-01-10', '2027-07-10']);
  assert.deepEqual(datesOf({ 날짜: ['2027-03-10', '2028-01-01'] }, d('2026-11-01'), d('2027-12-31')).map(ymd), ['2027-03-10']);
  // 2027-01-10은 일요일 → 11일(월), 공휴일이 겹치면 그다음 평일
  assert.equal(ymd(shift(d('2027-01-10'), new Set())), '2027-01-11');
  assert.equal(ymd(shift(d('2027-01-10'), new Set(['2027-01-11']))), '2027-01-12');
});

test('세무달력: 파일 읽기 · 기간 글 · 형식 오류 · 제출함 표시', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-tax-'));
  const dir = path.join(root, '테스트회사', '재경부');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '세무달력.yaml'), `회사: 테스트회사
확인: 2026-11-01
범위: { 부터: 2026-11-01, 까지: 2027-02-28 }
공휴일: [2027-02-08]
항목:
  - id: 원천세
    이름: 원천세 신고·납부
    분류: 원천세
    대상: [직원, 프리랜서]
    마감: { 매월: 10 }
    기간: "{전월연도}년 {전월}월 지급분"
    준비: [급여대장, 지급 내역]
  - id: 잘못
    이름: 잘못된 항목
    분류: 없는분류
    마감: {}
`);
  const cal = buildCalendar(path.join(dir, '세무달력.yaml'));
  const ws = cal.events.filter((e) => e.item === '원천세');
  assert.deepEqual(ws.map((e) => e.date), ['2026-11-10', '2026-12-10', '2027-01-11', '2027-02-10']);
  assert.equal(ws[2].shifted, true);
  assert.equal(ws[2].due, '2027-01-10');
  assert.equal(ws[2].period, '2026년 12월 지급분');
  assert.ok(cal.errors.some((e) => /분류는/.test(e)));
  assert.ok(cal.errors.some((e) => /마감은/.test(e)));
  const tc = createTaxCal({ root: () => root });
  assert.equal(tc.list().length, 1);
  tc.mark('테스트회사', ws[0].key, true);
  assert.ok(tc.list()[0].events.find((e) => e.key === ws[0].key).done);
  tc.mark('테스트회사', ws[0].key, false);
  assert.equal(tc.list()[0].events.find((e) => e.key === ws[0].key).done, null);
});

test('세무달력: "이름: 설명" 줄도 글로 (화면이 객체를 그리다 멈추지 않게)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-tax2-'));
  const f = path.join(root, '세무달력.yaml');
  fs.writeFileSync(f, `항목:\n  - id: a\n    이름: A\n    분류: 기타\n    마감: { 매월: 10 }\n    준비:\n      - 프리랜서 지급 내역: 이름, 지급액\n      - 그냥 글\n`);
  const it = buildCalendar(f).items[0];
  assert.deepEqual(it.준비, ['프리랜서 지급 내역: 이름, 지급액', '그냥 글']);
});
