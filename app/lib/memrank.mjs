// 기억 정리: 보관함 문서마다 "어떤 기억인지(층) · 어떻게 쌓였는지(출처) · 얼마나 무거운지(무게)"를 매긴다.
//   층   지금(손이 가는 일) · 기준(늘 지키는 것) · 결과(다시 찾아볼 것) · 흔적(그냥 남은 기록)
//   출처 내가 말함 · 내가 결정 · 내가 승인 · 내가 시킴 · 세션이 씀 · 따라 적음(바깥 세션) · 예약 실행 · 자동 기록 · 규칙
//   무게 0~100 — 종류 기본값에 사람 손길·내용 분량·다른 문서의 참조·최근성·상태를 더하고 뺀다. 매긴 까닭을 줄마다 남긴다.
// 파일은 고치지 않는다(읽어서 계산만). 사람이 직접 고친 분류만 기억/분류.json에 남는다.
import fs from 'node:fs';
import path from 'node:path';
import { parseMemory, MEMORY_TYPES } from './memlog.mjs';

export const MARKS = '기억/분류.json';
export const LAYERS = ['지금', '기준', '결과', '흔적'];
export const ORIGINS = ['내가 말함', '내가 결정', '내가 승인', '내가 시킴', '세션이 씀', '따라 적음', '예약 실행', '자동 기록', '규칙'];
// 바깥 세션 결과 칸 꼬리표: "> 대화 기록의 마지막 답. …" (지난 기록 채움) · "> 턴이 끝난 때의 마지막 답. …" (lib/external.mjs)
const LAST_REPLY = /^>\s*(?:대화 기록의|턴이 끝난 때의) 마지막 답/m;
const LINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
const linksOf = (s) => [...String(s).matchAll(LINK)].map((m) => m[1].trim());

// 작업의 "## 결과" 칸 (다음 칸 머리말 전까지)
export function resultOf(body) {
  const m = /^## 결과[^\n]*\n([\s\S]*?)(?=^## (?:지시|진행 로그|결과)[ \t]*$|(?![\s\S]))/m.exec(String(body ?? ''));
  return m ? m[1].trim() : '';
}

// 읽을 만한 글자 수: 머리말·링크 괄호·코드 울타리·경로 줄·빈칸을 뺀 글자
export function substance(text) {
  return String(text ?? '')
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*-\s*`?[A-Za-z]:\\/.test(l))   // 결과물 경로 목록
    .join('\n')
    .replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, '$1')
    .replace(/[#>*`_|\-[\]()]/g, '')
    .replace(/\s+/g, '').length;
}

export function sizeLabel(n) {
  if (n < 150) return '짧음';
  if (n < 1200) return '보통';
  if (n < 5000) return '긺';
  return '아주 긺';
}

export function readMarks(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, MARKS), 'utf8')).items ?? {}; } catch { return {}; }
}

export function writeMark(root, id, mark, { now = new Date() } = {}) {
  const items = readMarks(root);
  if (!mark) delete items[id];
  else items[id] = { mark, at: localStamp(now) };
  fs.mkdirSync(path.dirname(path.join(root, MARKS)), { recursive: true });
  fs.writeFileSync(path.join(root, MARKS), JSON.stringify({ items }, null, 2));
  return items[id] ?? null;
}

const p2 = (n) => String(n).padStart(2, '0');
const localStamp = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const daysSince = (t, now) => {
  const ms = Date.parse(String(t ?? '').length === 16 ? `${t}:00` : t ?? '');
  return Number.isFinite(ms) ? (now - ms) / 86400000 : null;
};

// files: store.files() 형식 { rel, name, data, body }
export function rankMemory(files, { now = new Date(), marks = {} } = {}) {
  const docs = files.filter((f) => !f.rel.startsWith('템플릿/') && (f.data?.type || f.rel === 'CLAUDE.md'));
  const byId = new Map();
  for (const f of docs) byId.set(f.data?.id ?? f.name, f);

  // 기록(주인말·검수판정)에서 문서마다: 내가 한 말 수, 다시 연 수, 처음 시킨 말
  const said = new Map();
  const reopened = new Map();
  const ordered = new Set();
  const inLogs = new Map();
  for (const f of docs) {
    const type = f.data?.type;
    if (!MEMORY_TYPES[type]) continue;
    for (const e of parseMemory(f.body, { source: type, date: f.data.date })) {
      for (const id of new Set([e.task, ...e.links].filter(Boolean))) inLogs.set(id, (inLogs.get(id) ?? 0) + 1);
      if (!e.task) continue;
      if (type === '주인말') {
        said.set(e.task, (said.get(e.task) ?? 0) + 1);
        if (['지시', '지금 실행'].includes(e.kind)) ordered.add(e.task);
      }
      if (type === '검수판정' && e.kind === '다시 열기') reopened.set(e.task, (reopened.get(e.task) ?? 0) + 1);
    }
  }
  // 다른 문서가 가리키는 수 (기록 파일은 빼고 — 기록은 모든 걸 가리키므로 따로 센다)
  const refs = new Map();
  for (const f of docs) {
    if (MEMORY_TYPES[f.data?.type]) continue;
    const self = f.data?.id ?? f.name;
    for (const id of new Set(linksOf(`${JSON.stringify(f.data ?? {})}\n${f.body}`))) if (id !== self) refs.set(id, (refs.get(id) ?? 0) + 1);
  }
  const scheduled = new Set(docs.filter((f) => f.data?.type === '작업' && (f.data.schedule || f.data.status === '대기예약')).map((f) => f.data.id));

  const items = [];
  for (const f of docs) {
    const d = f.data ?? {};
    const type = f.rel === 'CLAUDE.md' ? '노트' : d.type;
    if (['총괄', '공정'].includes(type)) continue;
    const id = type === '부서' ? `부서:${d.name}` : type === '하위' ? `하위:${d.dept}/${d.name}` : type === '노트' ? 'CLAUDE' : d.id ?? f.name;
    const key = d.id ?? f.name;
    const tags = Array.isArray(d.tags) ? d.tags : [];
    const reasons = [];
    const add = (n, why) => { if (n) reasons.push({ n, why }); return n; };
    let layer;
    let origin;
    let base;
    let text = f.body;
    const title = type === '노트' ? '공통 규칙' : type === '부서' ? `${d.name} 규칙` : type === '하위' ? d.name
      : type === '기억카드' ? String(d.rule ?? f.name) : type === '배움' ? `배움 ${d.date}` : MEMORY_TYPES[type] ? `${{ 주인말: '주인 말', 검수판정: '검수 판정', 세션지시: '세션 지시' }[type]} ${d.date}` : d.title ?? f.name;

    switch (type) {
      case '기억카드':
        layer = d.status === '사용' ? '기준' : '흔적'; origin = '내가 승인'; base = d.status === '사용' ? 62 : 15;
        reasons.push({ n: base, why: d.status === '사용' ? '승인된 판단 기준 — 세션 지시문에 붙음' : '버린 카드' });
        break;
      case '노트': layer = '기준'; origin = '규칙'; base = 58; reasons.push({ n: base, why: '모든 세션이 읽는 공통 규칙' }); break;
      case '부서': layer = '기준'; origin = '규칙'; base = 50; reasons.push({ n: base, why: '부서 일하는 방식' }); break;
      case '하위': layer = '기준'; origin = '규칙'; base = 42; reasons.push({ n: base, why: '하위 항목 안내 — 그 일을 할 때 읽음' }); break;
      case '지표': layer = '기준'; origin = '규칙'; base = 40; reasons.push({ n: base, why: '목표 지표' }); break;
      case '결정':
        origin = '내가 결정';
        if (d.status !== '결정됨') { layer = '지금'; base = 60; reasons.push({ n: base, why: '내 결정을 기다림' }); }
        else if (d.kind === '기억') { layer = '흔적'; base = 16; reasons.push({ n: base, why: '기억 카드 승인 기록 — 본체는 카드' }); }
        else { layer = '결과'; base = 44; reasons.push({ n: base, why: '내가 고른 답 — 왜 그렇게 했는지 남음' }); }
        break;
      case '보고서': layer = '결과'; origin = '세션이 씀'; base = 42; reasons.push({ n: base, why: '세션이 정리한 보고서' }); break;
      case '일지': layer = '흔적'; origin = '세션이 씀'; base = 20; reasons.push({ n: base, why: '일지' }); break;
      case '배움': layer = '결과'; origin = '자동 기록'; base = 30; reasons.push({ n: base, why: '일하다 알게 된 것 모음 — 쌓이면 스킬로 (세션·저녁 추출·내가 적음)' }); break;
      case '주인말': layer = '흔적'; origin = '내가 말함'; base = 22; reasons.push({ n: base, why: '그날 내가 한 말을 시간순으로 모은 원문' }); break;
      case '검수판정': layer = '흔적'; origin = '자동 기록'; base = 12; reasons.push({ n: base, why: '검수 판정을 서버가 자동으로 쌓음' }); break;
      case '세션지시': layer = '흔적'; origin = '자동 기록'; base = 12; reasons.push({ n: base, why: '바깥 세션에서 한 말을 서버가 모음' }); break;
      case '작업': {
        const res = resultOf(f.body);
        text = res;
        const outside = tags.includes('바깥세션');
        const parent = String(d.parent ?? '').match(/\[\[([^\]]+)\]\]/)?.[1];
        origin = outside ? '따라 적음' : parent && scheduled.has(parent) ? '예약 실행' : d.status === '대기예약' ? '예약 실행' : ordered.has(d.id) || d.session ? '내가 시킴' : '세션이 씀';
        if (['실행중', '결정대기', '검수'].includes(d.status)) { layer = '지금'; base = 40; reasons.push({ n: base, why: `지금 ${d.status}` }); }
        else if (d.status === '대기예약') { layer = '기준'; base = 34; reasons.push({ n: base, why: '정해 둔 예약 — 때가 되면 돔' }); }
        else if (d.status === '취소') { layer = '흔적'; base = 6; reasons.push({ n: base, why: '취소한 작업' }); }
        // 바깥 세션의 "결과"는 대화 기록의 마지막 답을 옮겨 둔 것뿐 — 정리된 결과가 아니다
        else if (outside && LAST_REPLY.test(res)) { layer = '흔적'; base = 14; reasons.push({ n: base, why: '쉬는 바깥 세션 — 결과 칸은 대화의 마지막 답일 뿐' }); }
        else if (substance(res) >= 300) { layer = '결과'; base = 30; reasons.push({ n: base, why: '끝난 작업 — 결과가 남음' }); }
        else { layer = '흔적'; base = 14; reasons.push({ n: base, why: res ? '끝난 작업 — 결과가 짧음' : '끝난 작업 — 결과 없음' }); }
        if (origin === '내가 시킴') add(8, '내가 직접 시킨 일');
        if (origin === '따라 적음' && tags.includes('자동이름') && !res) add(-6, '다른 곳 대화를 두뇌가 따라 적기만 함');
        if (d.decision) add(6, '중간에 내가 결정함');
        break;
      }
      default:
        layer = '흔적'; origin = '자동 기록'; base = 10; reasons.push({ n: base, why: type ?? '기타' });
    }

    const size = substance(text);
    // 내용 분량 (기록 파일은 하루치 줄 수가 분량이라 빼고, 기준 문서는 분량보다 역할이 중요하므로 조금만)
    if (!MEMORY_TYPES[type] && !(type === '작업' && tags.includes('바깥세션') && LAST_REPLY.test(text))) {
      const s = size < 150 ? 0 : size < 1200 ? 4 : size < 5000 ? 9 : 13;
      add(layer === '기준' ? Math.round(s / 2) : s, `내용 ${sizeLabel(size)} (${size.toLocaleString()}자)`);
    }
    const r = refs.get(key) ?? 0;
    if (r) add(Math.min(12, r * 3), `다른 문서 ${r}곳이 가리킴`);
    const s = said.get(key) ?? 0;
    if (s) add(Math.min(12, s * 4), `내가 ${s}번 말함`);
    const ro = reopened.get(key) ?? 0;
    if (ro) add(Math.min(10, ro * 5), `검수에서 ${ro}번 다시 엶`);
    if (d.status === '결정대기') add(15, '내 차례 — 결정 필요');
    else if (d.status === '검수' && type === '작업') {
      // 바깥 세션은 대화가 끝나면 저절로 검수에 들어가 오래 머문다 — 덜 급하게
      const stale = (daysSince(d.updated ?? d.created, now) ?? 0) > 7;
      if (tags.includes('바깥세션')) add(stale ? -8 : 2, stale ? '검수에 일주일 넘게 머묾 (바깥 세션)' : '검수 대기 (바깥 세션)');
      else add(10, '내 차례 — 검수 필요');
    }
    const age = daysSince(d.updated ?? d.created ?? d.date, now);
    if (age != null && layer !== '기준') {
      if (age <= 3) add(8, '최근 3일 안');
      else if (age <= 14) add(3, '최근 2주 안');
      else if (age > 30) add(-6, '한 달 넘게 안 건드림');
    }

    let score = Math.max(0, Math.min(100, reasons.reduce((a, x) => a + x.n, 0)));
    const mark = marks[id]?.mark ?? marks[key]?.mark ?? null;
    if (mark === '핵심') { score = Math.max(score, 80); if (layer === '흔적') layer = '결과'; reasons.push({ n: 0, why: '내가 핵심으로 고정' }); }
    if (mark === '흔적') { layer = '흔적'; score = Math.min(score, 10); reasons.push({ n: 0, why: '내가 흔적으로 내림' }); }
    const grade = score >= 60 ? '핵심' : score >= 35 ? '참고' : '흔적';
    items.push({
      id, type, title, dept: type === '부서' ? d.name : d.dept ?? null, unit: d.unit ?? null, status: d.status ?? null,
      layer, origin, score, grade, mark, reasons, size, sizeLabel: sizeLabel(size),
      refs: r, said: s, inLogs: inLogs.get(key) ?? 0,
      time: d.updated ?? d.created ?? d.date ?? null, created: d.created ?? d.date ?? null,
      outside: tags.includes('바깥세션'),
    });
  }
  items.sort((a, b) => b.score - a.score || String(b.time ?? '').localeCompare(String(a.time ?? '')));
  const count = (k) => Object.fromEntries([...new Set(items.map((x) => x[k]))].map((v) => [v, items.filter((x) => x[k] === v).length]));
  return { items, totals: { layer: count('layer'), origin: count('origin'), grade: count('grade') }, at: localStamp(now) };
}
