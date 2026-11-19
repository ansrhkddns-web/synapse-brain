// 세무달력 (경영지원실 / 재경부): 회사 폴더의 재경부\세무달력.yaml을 읽어 반복 규칙을 날짜로 펼친다.
//   <경영지원실 workdir>\<회사>\재경부\세무달력.yaml
//     회사: 예시 회사
//     확인: 2026-11-01            # 규칙·공휴일을 공식 출처로 확인한 날
//     범위: { 부터: 2026-11-01, 까지: 2027-12-31 }
//     공휴일: [2026-12-25, …]     # 마감이 이 날·토·일이면 다음 평일로 (국세기본법 제5조 등)
//     항목:
//       - id: 원천세
//         이름: 원천세 신고·납부
//         분류: 원천세            # 부가세·원천세·지급명세서·소득세·법인세·지방세·4대보험·기타
//         대상: [직원, 프리랜서]   # 회사 유형 거르기: 개인일반·개인간이·법인·직원·프리랜서·기타소득·모두
//         마감: { 매월: 10 }      # { 매월: 10 | 말일 } · { 매년: [01-25, 07-25] } · { 날짜: [2027-03-10] }
//         기간: "{전월}월 지급분"  # 이번 마감이 다루는 기간 ({전월} {전월연도} {연도} {전년} {반기})
//         방법: 홈택스 > …
//         준비: [ … ]
//         담당: 사람 / 세무사
//         근거: 소득세법 제128조
//         출처: https://…
//         미루기: 예               # 아니오면 공휴일이어도 그대로
//         메모: …
// 끝냄 표시는 같은 폴더의 세무달력_완료.json  { "<항목 id>@<원래 마감 날짜>": "2026-11-09T10:12" }
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export const KINDS = ['부가세', '원천세', '지급명세서', '소득세', '법인세', '지방세', '4대보험', '기타'];
export const TARGETS = ['개인일반', '개인간이', '법인', '직원', '프리랜서', '기타소득', '모두'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (y, m, d) => new Date(y, m - 1, d);
const lastDay = (y, m) => new Date(y, m, 0).getDate();

// 마감이 토·일·공휴일이면 다음 평일
export function shift(date, holidays) {
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6 || holidays.has(ymd(d))) d.setDate(d.getDate() + 1);
  return d;
}

const periodText = (tpl, due) => {
  if (!tpl) return null;
  const y = due.getFullYear(), m = due.getMonth() + 1;
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  return String(tpl).replace(/\{전월\}/g, pm).replace(/\{전월연도\}/g, py).replace(/\{연도\}/g, y).replace(/\{전년\}/g, y - 1)
    .replace(/\{반기\}/g, m <= 6 ? `${y - 1}년 하반기` : `${y}년 상반기`);
};

// 규칙 하나 → 범위 안의 원래 마감 날짜들
export function datesOf(rule, from, to) {
  const out = [];
  const r = rule ?? {};
  if (r.매월 != null) {
    for (let y = from.getFullYear(), m = from.getMonth() + 1; at(y, m, 1) <= to; m === 12 ? (y += 1, m = 1) : (m += 1)) {
      const day = r.매월 === '말일' ? lastDay(y, m) : Math.min(Number(r.매월), lastDay(y, m));
      const months = r.달 ? [].concat(r.달).map(Number) : null;   // { 매월: 10, 달: [1, 7] } — 그 달만
      if (months && !months.includes(m)) continue;
      out.push(at(y, m, day));
    }
  }
  for (const md of [].concat(r.매년 ?? [])) {
    const [mm, dd] = String(md).split('-').map(Number);
    for (let y = from.getFullYear(); y <= to.getFullYear(); y += 1) out.push(dd === 0 || String(md).endsWith('말일') ? at(y, mm, lastDay(y, mm)) : at(y, mm, dd));
  }
  for (const s of [].concat(r.날짜 ?? [])) { const [y, m, d] = String(s).split('-').map(Number); out.push(at(y, m, d)); }
  return out.filter((d) => d >= from && d <= to).sort((a, b) => a - b);
}

export function check(cal) {
  const errors = [];
  const ids = new Set();
  if (!Array.isArray(cal?.항목)) return ['항목 목록이 없음'];
  for (const [i, it] of cal.항목.entries()) {
    const where = `항목 ${i + 1}(${it?.id ?? it?.이름 ?? '?'})`;
    if (!it?.id) errors.push(`${where}: id가 없음`);
    else if (ids.has(it.id)) errors.push(`${where}: id가 겹침`);
    ids.add(it?.id);
    if (!it?.이름) errors.push(`${where}: 이름이 없음`);
    if (!KINDS.includes(it?.분류)) errors.push(`${where}: 분류는 ${KINDS.join('·')} 중 하나`);
    for (const t of [].concat(it?.대상 ?? [])) if (!TARGETS.includes(t)) errors.push(`${where}: 대상 "${t}" — ${TARGETS.join('·')} 중`);
    const m = it?.마감;
    if (!m || (m.매월 == null && m.매년 == null && m.날짜 == null)) errors.push(`${where}: 마감은 매월·매년·날짜 중 하나`);
  }
  return errors;
}

// 회사 폴더 하나의 달력 → 펼친 일정
export function buildCalendar(file, { now = new Date() } = {}) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const cal = parseYaml(raw) ?? {};
  const errors = check(cal);
  const holidays = new Set([].concat(cal.공휴일 ?? []).map(String));
  const from = cal.범위?.부터 ? new Date(`${cal.범위.부터}T00:00`) : at(now.getFullYear(), now.getMonth() + 1, 1);
  const to = cal.범위?.까지 ? new Date(`${cal.범위.까지}T00:00`) : at(now.getFullYear() + 1, 12, 31);
  const doneFile = path.join(path.dirname(file), '세무달력_완료.json');
  let done = {};
  try { done = JSON.parse(fs.readFileSync(doneFile, 'utf8')); } catch { /* 아직 없음 */ }
  const events = [];
  for (const it of Array.isArray(cal.항목) ? cal.항목 : []) {
    for (const due of datesOf(it.마감, from, to)) {
      const real = it.미루기 === '아니오' || it.미루기 === false ? due : shift(due, holidays);
      const key = `${it.id}@${ymd(due)}`;
      events.push({ key, item: it.id, date: ymd(real), due: ymd(due), shifted: ymd(real) !== ymd(due), period: periodText(it.기간, due), done: done[key] ?? null });
    }
  }
  events.sort((a, b) => (a.date === b.date ? a.item.localeCompare(b.item) : a.date < b.date ? -1 : 1));
  // YAML에서 "이름: 설명"처럼 쓴 줄은 객체로 읽히므로 글로 되돌린다 (화면은 글만 그린다)
  const text = (v) => (v == null ? v : typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k, x]) => `${k}: ${text(x)}`).join(' · ') : Array.isArray(v) ? v.map(text).join(', ') : String(v));
  const items = (Array.isArray(cal.항목) ? cal.항목 : []).map((it) => ({
    ...it, 대상: [].concat(it.대상 ?? ['모두']), 준비: [].concat(it.준비 ?? []).map(text),
    ...Object.fromEntries(['이름', '짧게', '기간', '할일', '방법', '담당', '근거', '출처', '메모'].filter((k) => it[k] != null).map((k) => [k, text(it[k])])),
  }));
  return {
    company: cal.회사 ?? path.basename(path.dirname(path.dirname(file))), checked: cal.확인 ?? null, profile: cal.프로필 ?? {},
    range: { from: ymd(from), to: ymd(to) }, holidays: [...holidays].sort(), notes: [].concat(cal.알림 ?? []), items, events, errors, file,
  };
}

// 경영지원실 작업 폴더 아래 회사마다
export function createTaxCal({ root }) {
  const files = () => {
    let names = [];
    try { names = fs.readdirSync(root(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
    return names.map((n) => path.join(root(), n, '재경부', '세무달력.yaml')).filter((f) => fs.existsSync(f));
  };
  return {
    list: () => files().map((f) => { try { return buildCalendar(f); } catch (e) { return { company: path.basename(path.dirname(path.dirname(f))), file: f, errors: [`읽기 실패: ${e.message}`], items: [], events: [] }; } }),
    // 끝냄 표시 (사람이 화면에서): done=true면 지금 시각을 적고, false면 지운다
    mark: (company, key, done) => {
      const f = files().find((x) => { try { return buildCalendar(x).company === company; } catch { return false; } });
      if (!f) throw Object.assign(new Error(`세무달력 없음: ${company}`), { status: 404 });
      const doneFile = path.join(path.dirname(f), '세무달력_완료.json');
      let cur = {};
      try { cur = JSON.parse(fs.readFileSync(doneFile, 'utf8')); } catch { /* 처음 */ }
      if (done) { const d = new Date(); cur[key] = `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; } else delete cur[key];
      fs.writeFileSync(`${doneFile}.tmp`, JSON.stringify(cur, null, 2));
      fs.renameSync(`${doneFile}.tmp`, doneFile);
      return { key, done: cur[key] ?? null };
    },
  };
}
