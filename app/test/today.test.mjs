// 일정비서: 바깥 일(마감 지남·오늘·이번 주·확인 못 한 것) + 두뇌 안 일(내 차례·예약·돌고 있는 일)을 날짜에 맞게
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderToday, createToday, targetOf, REL, FEED } from '../lib/today.mjs';

const now = new Date(2026, 10, 4, 9, 0);   // 2026-11-04 (수) 09:00
const feed = {
  at: '2026-11-04T08:30', sources: ['Asana', '슬랙'],
  items: [
    { source: 'Asana', title: '지난 일', due: '2026-11-01', kind: '마감' },
    { source: 'Asana', title: '오늘 일', due: '2026-11-04', kind: '마감' },
    { source: 'Asana', title: '금요일 일', due: '2026-11-06', kind: '마감', url: 'https://app.asana.com/x' },
    { source: 'Asana', title: '먼 일', due: '2026-12-30', kind: '마감' },
    { source: '슬랙', title: '서재원 차장 질문', kind: '확인', note: '답 안 함' },
  ],
};

test('일정비서: 마감을 지남·오늘·이번 주로 나누고, 먼 마감은 뺀다', () => {
  const { date, body } = renderToday({ now, feed, tasks: [], attention: [], doneLines: [] });
  assert.equal(date, '2026-11-04');
  assert.match(body, /# 일정비서 · 2026-11-04 \(수\)/);
  const part = (h) => body.split(`## ${h}`)[1].split('\n## ')[0];
  assert.match(part('마감 지남'), /지난 일.*3일 지남/);
  assert.match(part('오늘 마감'), /오늘 일/);
  assert.match(part('이번 주 마감'), /\[금요일 일\]\(https:\/\/app\.asana\.com\/x\).*11\/6\(금\)/);
  assert.doesNotMatch(body, /먼 일/);
  assert.match(part('확인 못 한 것'), /서재원 차장 질문 — 답 안 함/);
});

test('일정비서: 두뇌 차례·오늘 예약·돌고 있는 일, 모음이 없으면 그렇다고 적는다', () => {
  const tasks = [
    { id: 'W-1', title: '검수 볼 일', dept: '분석실', status: '검수' },
    { id: 'W-2', title: '아침 보고', dept: '비서실', status: '대기예약', schedule: '평일 08:00' },
    { id: 'W-3', title: '주말 일', dept: '비서실', status: '대기예약', schedule: '토요일 08:00' },
    { id: 'W-4', title: '도는 일', dept: '개발실', unit: '두뇌앱', status: '실행중' },
  ];
  const { body } = renderToday({ now, feed: null, tasks, attention: [{ kind: '검수', task: 'W-1', title: '검수 볼 일' }], doneLines: [] });
  assert.match(body, /아직 오늘 모으지 않음/);
  assert.match(body, /\*\*검수\*\* \[\[W-1\]\] 검수 볼 일 — 분석실/);
  assert.match(body, /08:00 \[\[W-2\]\] 아침 보고.*시각 지남/);
  assert.doesNotMatch(body, /주말 일/);
  assert.match(body, /\[\[W-4\]\] 도는 일 — 개발실 \/ 두뇌앱/);
});

test('일정비서: 하위 문서로 쓰고, 바뀐 게 없으면 다시 쓰지 않는다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-today-'));
  fs.mkdirSync(path.join(root, '기억'), { recursive: true });
  fs.writeFileSync(path.join(root, FEED('2026-11-04')), JSON.stringify(feed));
  const t = createToday({ root, now: () => now, collect: () => ({ tasks: [], attention: [] }) });
  assert.equal(t.refresh(), true);
  const text = fs.readFileSync(path.join(root, REL), 'utf8');
  assert.match(text, /^---\ntype: 하위\nname: 일정비서\ndept: 비서실/);
  assert.match(text, /오늘 일/);
  assert.equal(t.refresh(), false);
  assert.equal(createToday({ root, now: () => now, collect: () => ({ tasks: [], attention: [] }) }).refresh(), false);
});

test('일정비서: 대상(target·"이름 직함:"·Asana [프로젝트]·두뇌 하위 항목)별로 섹션 안에서 묶고, 대상 없는 건 단독', () => {
  assert.deepEqual(targetOf({ source: '슬랙', title: '서재원 차장: 견적 회신' }), { target: '서재원 차장', title: '견적 회신' });
  assert.deepEqual(targetOf({ source: 'Asana', title: '[신작게임] 볼륨 고도화' }), { target: '신작게임', title: '볼륨 고도화' });
  assert.deepEqual(targetOf({ source: '슬랙', title: '[공지] 점검' }), { target: null, title: '[공지] 점검' });
  assert.deepEqual(targetOf({ source: 'Asana', title: '[던전] 리포트', target: '던전앤잉글리시' }), { target: '던전앤잉글리시', title: '[던전] 리포트' });
  assert.deepEqual(targetOf({ source: '슬랙', title: '이준희 과장: 회의록', target: '이준희과장' }), { target: '이준희과장', title: '회의록' });
  assert.deepEqual(targetOf({ source: '슬랙', title: '서재원 차장 질문' }), { target: null, title: '서재원 차장 질문' });

  const f = { at: '2026-11-04T08:40', sources: ['슬랙'], items: [
    { source: '슬랙', kind: '확인', title: '서재원 차장: 개인정보 처리방침 추가?', note: '답 안 함' },
    { source: '슬랙', kind: '확인', title: '혼자 온 연락' },
    { source: '슬랙', kind: '확인', title: '서재원차장: 메일 확인', url: 'https://slack.com/x' },
    { source: '슬랙', kind: '마감', title: '서재원 차장: 견적서', due: '2026-11-05' },
    { source: 'Asana', kind: '마감', title: '[신작게임] 볼륨', due: '2026-11-03' },
  ] };
  const tasks = [{ id: 'W-9', title: '도는 일', dept: '개발실', unit: '두뇌앱', status: '실행중' }, { id: 'W-8', title: '부서만', dept: '분석실', status: '실행중' }];
  const { body, view } = renderToday({ now, feed: f, tasks, attention: [], doneLines: ['- [x] 10:23 [[W-9]] 끝난 일 (검수 → 확인)'] });
  const sec = (k) => view.sections.find((s) => s.key === k);

  // 섹션 안: 대상 카드 하나에 두 일정, 대상 없는 건 단독. 다른 섹션에도 있으면 적는다
  const missed = sec('missed');
  assert.equal(missed.count, 3);
  assert.equal(missed.entries.length, 2);
  assert.equal(missed.entries[0].target, '서재원 차장');
  assert.deepEqual(missed.entries[0].items.map((c) => c.title), ['개인정보 처리방침 추가?', '메일 확인']);
  assert.deepEqual(missed.entries[0].also, ['이번 주 마감']);
  assert.equal(missed.entries[1].items, undefined);
  assert.equal(missed.entries[1].title, '혼자 온 연락');
  assert.equal(sec('week').entries[0].target, '서재원 차장');
  // 지난 마감·체크·출처
  const late = sec('overdue').entries[0];
  assert.equal(late.target, '신작게임');
  assert.equal(late.items[0].late, 1);
  assert.equal(late.items[0].box, ' ');
  assert.equal(late.items[0].source, 'Asana');
  // 두뇌: 하위 항목, 없으면 부서. 끝낸 일도 작업의 대상으로
  assert.deepEqual(sec('running').entries.map((e) => e.target), ['두뇌앱', '분석실']);
  assert.equal(sec('done').entries[0].target, '두뇌앱');
  assert.equal(sec('done').entries[0].items[0].task, 'W-9');

  // 본문: 대상 줄 아래 들여쓴 일정 (위키 링크·체크 그대로)
  assert.match(body, /- \*\*서재원 차장\*\* \(2\) · 이번 주 마감에도 있음\n {2}- \[ \] `슬랙` 개인정보 처리방침 추가\? — 답 안 함\n {2}- \[ \] `슬랙` \[메일 확인\]\(https:\/\/slack\.com\/x\)/);
  assert.match(body, /\n- \[ \] `슬랙` 혼자 온 연락\n/);
  assert.match(body, /- \*\*신작게임\*\* \(1\)\n {2}- \[ \] `Asana` 볼륨 — 마감 11\/3\(화\) · \*\*1일 지남\*\*/);
  assert.match(body, /- \*\*두뇌앱\*\* \(1\) · 끝낸 일에도 있음\n {2}- \[\[W-9\]\] 도는 일 — 개발실 \/ 두뇌앱/);
  assert.match(body, /- \*\*두뇌앱\*\* \(1\) · 돌고 있는 일에도 있음\n {2}- \[x\] 10:23 \[\[W-9\]\] 끝난 일/);
});

test('일정비서: 카드 모델이 본문과 빠짐없이 같다 — 섹션 9개, 일정 수가 줄 수와 같다', () => {
  const tasks = [
    { id: 'W-1', title: '검수 볼 일', dept: '분석실', status: '검수' },
    { id: 'W-2', title: '아침 보고', dept: '비서실', unit: '일정비서', status: '대기예약', schedule: '평일 08:00' },
    { id: 'W-4', title: '도는 일', dept: '개발실', status: '실행중' },
  ];
  const { body, view } = renderToday({ now, feed, tasks, attention: [{ kind: '검수', task: 'W-1' }, { kind: '입력대기', task: null, title: '바깥 세션', body: '답 기다림' }], doneLines: ['- [x] 09:00 이름 없는 완료'] });
  assert.equal(view.sections.length, 9);
  for (const s of view.sections) {
    assert.ok(body.includes(`## ${s.title}`), s.title);
    const cards = s.entries.flatMap((e) => e.items ?? [e]);
    assert.equal(cards.length, s.count, s.title);
    const part = body.split(`## ${s.title}`)[1].split('\n## ')[0];
    for (const c of cards) assert.ok(part.includes(c.line), `${s.title}: ${c.line}`);
    assert.equal((part.match(/^ {0,2}- (?!\*\*)/gm) ?? []).length, s.count || 1, s.title);
  }
  // 대상 없는 바깥 세션 차례는 단독
  assert.equal(view.sections.find((s) => s.key === 'mine').entries[1].title, '바깥 세션');
});

test('일정비서: 끝난 바깥 일은 할 일에서 빠진다 — 모음이 done으로 주면 자동, 사람이 완료로 지우면 다음 모음에도 안 뜬다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-today-'));
  fs.mkdirSync(path.join(root, '기억'), { recursive: true });
  const f = { at: '2026-11-04T08:40', items: [
    { source: 'Asana', kind: '마감', title: '[신작게임] 볼륨', due: '2026-11-06', url: 'https://app.asana.com/a' },
    { source: '슬랙', kind: '확인', title: '서재원 차장: 견적 회신', id: 'slack:C1:111' },
    { source: '슬랙', kind: '확인', title: '이준희 과장: 회의록 확인', done: true },
  ] };
  fs.writeFileSync(path.join(root, FEED('2026-11-04')), JSON.stringify(f));
  const t = createToday({ root, now: () => now, collect: () => ({ tasks: [], attention: [] }) });
  const sec = (v, k) => v.sections.find((s) => s.key === k);
  const cards = (s) => s.entries.flatMap((e) => e.items ?? [e]);
  let v = t.view();
  assert.equal(sec(v, 'missed').count, 1);                       // done으로 온 회의록은 빠짐
  assert.match(cards(sec(v, 'done'))[0].note, /끝남 확인/);
  const slack = cards(sec(v, 'missed'))[0];
  assert.equal(slack.id, 'slack:C1:111');
  assert.equal(cards(sec(v, 'week'))[0].id, 'u:https://app.asana.com/a');

  assert.ok(t.clear('slack:C1:111'));
  assert.equal(t.clear('없는 id'), null);
  v = t.view();
  assert.equal(sec(v, 'missed').count, 0);
  const gone = cards(sec(v, 'done')).find((c) => c.id === 'slack:C1:111');
  assert.equal(gone.undo, true);
  assert.equal(gone.title, '견적 회신');
  assert.match(fs.readFileSync(path.join(root, REL), 'utf8'), /견적 회신.*완료 처리/);
  // 다음 모음이 같은 일을 다시 줘도 뜨지 않는다 (같은 id)
  fs.writeFileSync(path.join(root, FEED('2026-11-04')), JSON.stringify({ ...f, at: '2026-11-04T13:40' }));
  assert.equal(sec(t.view(), 'missed').count, 0);
  // 되살리기
  assert.ok(t.clear('slack:C1:111', { undo: true }));
  assert.equal(sec(t.view(), 'missed').count, 1);
});

test('일정비서: 내 일 아님(스킵) — 할 일에서 빠져 따로 모이고, 다음 모음에도 안 뜨고, 되돌릴 수 있다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-today-'));
  fs.mkdirSync(path.join(root, '기억'), { recursive: true });
  const f = { at: '2026-11-04T08:40', items: [{ source: '슬랙', kind: '확인', title: '김과장: 다른 팀 공지', id: 'slack:C2:222' }] };
  fs.writeFileSync(path.join(root, FEED('2026-11-04')), JSON.stringify(f));
  const t = createToday({ root, now: () => now, collect: () => ({ tasks: [], attention: [] }) });
  const sec = (k) => t.view().sections.find((s) => s.key === k);
  assert.equal(sec('skip'), undefined);                          // 스킵이 없으면 섹션도 없다
  assert.ok(t.clear('slack:C2:222', { skip: true }));
  assert.equal(sec('missed').count, 0);
  assert.equal(sec('done').count, 0);                            // 끝낸 일에는 안 섞인다
  const c = sec('skip').entries.flatMap((e) => e.items ?? [e])[0];
  assert.equal(c.skipped, true);
  assert.equal(c.undo, true);
  assert.match(fs.readFileSync(path.join(root, REL), 'utf8'), /내 일 아님/);
  fs.writeFileSync(path.join(root, FEED('2026-11-04')), JSON.stringify({ ...f, at: '2026-11-04T13:40' }));
  assert.equal(sec('missed').count, 0);
  assert.ok(t.clear('slack:C2:222', { undo: true }));
  assert.equal(sec('missed').count, 1);
  assert.equal(sec('skip'), undefined);
});

test('일정비서: 완료 처리는 모음이 나중에 id를 새로 붙여도 이어진다 (링크·제목으로도 알아본다)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-today-'));
  fs.mkdirSync(path.join(root, '기억'), { recursive: true });
  const write = (items) => fs.writeFileSync(path.join(root, FEED('2026-11-04')), JSON.stringify({ at: '2026-11-04T08:40', items }));
  write([{ source: '지시방', kind: '오늘', title: '영상 하루 1개 시청' }, { source: 'Asana', kind: '오늘', title: '[던전] 리포트', url: 'https://app.asana.com/b' }]);
  const t = createToday({ root, now: () => now, collect: () => ({ tasks: [], attention: [] }) });
  const todo = () => t.view().sections.find((s) => s.key === 'todo');
  const ids = todo().entries.flatMap((e) => e.items ?? [e]).map((c) => c.id);
  for (const id of ids) assert.ok(t.clear(id));
  assert.equal(todo().count, 0);
  write([{ id: 'order:x1', source: '지시방', kind: '오늘', title: '영상 하루 1개 시청' }, { id: 'asana:9', source: 'Asana', kind: '오늘', title: '[던전] 리포트 (제목 바뀜)', url: 'https://app.asana.com/b' }]);
  assert.equal(todo().count, 0);
});

test('일정비서: 할 일에서 시킨 작업이 그 할 일에 이어진다 (모음이 id를 새로 붙여도)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-today-'));
  fs.mkdirSync(path.join(root, '기억'), { recursive: true });
  const write = (items) => fs.writeFileSync(path.join(root, FEED('2026-11-04')), JSON.stringify({ at: '2026-11-04T08:40', items }));
  write([{ source: '슬랙', kind: '확인', title: '서재원 차장: 처리방침 추가?', url: 'https://slack.com/p1' }]);
  const tasks = [{ id: 'W-261104-009', title: '서재원 차장 · 처리방침 추가?', dept: '비서실', unit: '일정비서', status: '실행중' }];
  const t = createToday({ root, now: () => now, collect: () => ({ tasks, attention: [] }) });
  const card = () => t.view().sections.find((s) => s.key === 'missed').entries[0].items[0];
  assert.equal(card().task, undefined);
  assert.ok(t.link(card().id, 'W-261104-009'));
  assert.equal(card().task, 'W-261104-009');
  assert.equal(card().taskLive, true);
  write([{ id: 'slack:D1:1.2', source: '슬랙', kind: '확인', title: '서재원 차장: 처리방침 추가?', url: 'https://slack.com/p1' }]);
  assert.equal(card().task, 'W-261104-009');
  assert.equal(t.link('없는 id', 'W-1'), null);
});
