// 보관함(vault/) 읽기와 형식 검사. 규칙 원문은 vault/CLAUDE.md, 칸 목록은 vault/템플릿/.
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseSchedule } from './schedule.mjs';

export const TASK_STATUS = ['대기예약', '실행중', '결정대기', '검수', '완료', '취소'];
export const DECISION_STATUS = ['대기', '결정됨'];
export const PROCESS_STATUS = ['가동', '정지'];
// 공정 실행기 상태: 대기(다음 단계 실행 전) · 대기열 · 실행 · 승인대기 · 실패 · 끝
export const PROCESS_PHASE = ['대기', '대기열', '실행', '승인대기', '실패', '끝'];
// 선택: 부서가 올린 선택지 / 권한: 도구 사용 허락 요청(서버가 만듦)
export const DECISION_KIND = ['선택', '권한', '기억', '스킬'];   // 기억 = 기억 카드 후보 결재, 스킬 = 배움을 스킬로 만들지 결재 (둘 다 세션을 깨우지 않음)

// 종류별: 들어갈 폴더, 파일 이름(=ID) 형식, 꼭 있어야 할 칸, 허용 칸
const KINDS = {
  작업: {
    dir: '작업', id: /^W-(\d{6})-\d{3}$/,
    required: ['id', 'title', 'dept', 'status', 'created', 'updated'],
    allowed: ['unit', 'session', 'schedule', 'last_run', 'parent', 'decision', 'tags'],
  },
  결정: {
    dir: '결정', id: /^D-(\d{6})-\d{3}$/,
    required: ['id', 'title', 'task', 'dept', 'status', 'created', 'options'],
    allowed: ['kind', 'recommended', 'choice', 'note'],
  },
  보고서: {
    dir: '보고서', id: /^R-(\d{6})-\d{3}$/,
    required: ['id', 'title', 'dept', 'created'],
    allowed: ['task', 'tags'],
  },
  일지: { dir: '일지', id: /^(\d{4}-\d{2}-\d{2})$/, required: ['date'], allowed: [] },
  // match: PC에서 도는 바깥 일(Claude Code 세션·AI 프로그램)을 이 부서·하위 항목 일로 볼 경로 조각 (lib/activity.mjs)
  부서: { dir: '부서', required: ['name', 'workdir'], allowed: ['order', 'summary', 'color', 'model', 'match'] },
  // 부서 안의 하위 항목(팀·시리즈·채널): 부서/<부서>/하위/<이름>.md
  // generated·date·updated: 서버가 날마다 다시 쓰는 하위 문서(비서실/일정비서 — lib/today.mjs)
  하위: { dir: '부서', required: ['name', 'dept'], allowed: ['order', 'summary', 'color', 'workdir', 'match', 'commands', 'generated', 'date', 'updated'] },
  // 공정: 하위 항목의 작업 프로세스(단계 목록·지금 단계·지금 작업물). 돌지 않아도 지도에 늘 뜬다 (부서/<부서>/공정/<이름>.md)
  공정: { dir: '부서', required: ['name', 'dept', 'status', 'stages'], allowed: ['unit', 'order', 'title', 'summary', 'stage', 'item', 'workdir', 'updated', 'steps', 'auto', 'phase', 'run', 'slug'] },
  지표: { dir: '지표', required: ['metrics'], allowed: ['updated'] },
  // 기억: 사람이 화면에서 한 말(지시·이어서·결정·질문)과 검수 판정 — 서버가 날마다 한 파일에 덧붙인다
  주인말: { dir: '기억', id: /^주인말-(\d{4}-\d{2}-\d{2})$/, byDate: '주인말-', required: ['date'], allowed: [] },
  검수판정: { dir: '기억', id: /^검수-(\d{4}-\d{2}-\d{2})$/, byDate: '검수-', required: ['date'], allowed: [] },
  // 세션 지시: Claude 앱 세션(바깥 세션)에서 한 말 — 기억 카드 후보를 뽑을 때 서버가 다시 모은다
  세션지시: { dir: '기억', id: /^세션지시-(\d{4}-\d{2}-\d{2})$/, byDate: '세션지시-', required: ['date'], allowed: [] },
  배움: { dir: '기억', id: /^배움-(\d{4}-\d{2}-\d{2})$/, byDate: '배움-', required: ['date'], allowed: [] },
  // 기억 카드: 사람이 승인한 규칙 한 줄. 세션 지시문에 붙는다 (기억/카드/K-YYMMDD-NNN.md)
  기억카드: { dir: '기억', id: /^K-(\d{6})-\d{3}$/, required: ['id', 'rule', 'status', 'created'], allowed: ['dept', 'unit', 'sources', 'decision', 'updated'] },
  // 그래프 한가운데: 모든 부서를 거느리는 비서실장 (보관함 맨 위 비서실장.md 하나)
  총괄: { file: '비서실장.md', required: ['name'], allowed: ['summary'] },
};

const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LINK = /^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/;
const BODY_LINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

export function splitFrontmatter(text) {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  return { yaml: m[1], body: m[2] };
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.md')) out.push(p);
  }
  return out;
}

export function loadVault(root) {
  const files = walk(root).map((abs) => {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const file = { abs, rel, name: path.basename(abs, '.md'), data: null, body: '', parseError: null };
    const fm = splitFrontmatter(fs.readFileSync(abs, 'utf8'));
    if (!fm) return file;
    try {
      file.data = parseYaml(fm.yaml) ?? {};
      file.body = fm.body;
    } catch (e) {
      file.parseError = e.message.split('\n')[0];
    }
    return file;
  });
  return { root, files };
}

// "[[W-261030-001]]" → "W-261030-001", 링크가 아니면 null
export function linkTarget(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(LINK);
  return m ? m[1].trim() : null;
}

// ID 날짜 261030 → 2026-10-30
function idDate(yymmdd) {
  return `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

export function checkVault(vault) {
  const errors = [];
  const warnings = [];
  const err = (f, msg) => errors.push(`${f.rel}: ${msg}`);
  const warn = (f, msg) => warnings.push(`${f.rel}: ${msg}`);

  // 링크 대상이 될 수 있는 이름 (파일 이름 기준, Obsidian과 같음)
  const byName = new Map();
  for (const f of vault.files) {
    if (byName.has(f.name) && !['규칙', 'CLAUDE'].includes(f.name) && !f.rel.includes('/하위/')) {
      err(f, `같은 이름의 파일이 이미 있음 (${byName.get(f.name).rel}) — 링크가 헷갈림`);
    }
    if (!byName.has(f.name)) byName.set(f.name, f);
    // 부서·하위 문서는 화면과 같은 이름(부서:X, 하위:부서/이름)으로도 링크할 수 있다
    if (f.data?.type === '부서') byName.set(`부서:${f.data.name}`, f);
    if (f.data?.type === '하위') byName.set(`하위:${f.data.dept}/${f.data.name}`, f);
  }

  const depts = new Set(
    vault.files.filter((f) => f.data?.type === '부서').map((f) => f.data.name),
  );
  // 하위 항목: "부서/이름"
  const units = new Set(
    vault.files.filter((f) => f.data?.type === '하위').map((f) => `${f.data.dept}/${f.data.name}`),
  );

  for (const f of vault.files) {
    const top = f.rel.split('/')[0];
    if (f.rel === 'CLAUDE.md' || top === '템플릿') {
      if (top === '템플릿' && f.parseError) err(f, `맨 위 YAML을 읽을 수 없음: ${f.parseError}`);
      continue;
    }
    if (f.parseError) { err(f, `맨 위 YAML을 읽을 수 없음: ${f.parseError}`); continue; }
    if (!f.data) { err(f, '맨 위에 --- 로 감싼 frontmatter가 없음'); continue; }

    const d = f.data;
    const kind = KINDS[d.type];
    if (!kind) { err(f, `type이 "${d.type}" — ${Object.keys(KINDS).join('·')} 중 하나여야 함`); continue; }
    if (kind.file ? f.rel !== kind.file : top !== kind.dir) err(f, kind.file ? `${d.type} 파일은 보관함 맨 위 ${kind.file} 하나뿐` : `${d.type} 파일은 ${kind.dir}/ 폴더에 있어야 함`);

    for (const k of kind.required) {
      if (d[k] === undefined || d[k] === null || d[k] === '') err(f, `"${k}" 칸이 비었음`);
    }
    const known = new Set(['type', ...kind.required, ...kind.allowed]);
    for (const k of Object.keys(d)) if (!known.has(k)) err(f, `모르는 칸 "${k}" — 템플릿에 없는 칸은 쓰지 않음`);

    // 파일 이름과 ID
    if (kind.id) {
      const m = f.name.match(kind.id);
      if (!m) err(f, `파일 이름이 형식(${kind.id.source})에 맞지 않음`);
      if (kind.byDate) {
        if (`${kind.byDate}${d.date}` !== f.name) err(f, `date(${d.date})가 파일 이름과 다름`);
      } else if (d.type === '일지') {
        if (String(d.date) !== f.name) err(f, `date(${d.date})가 파일 이름과 다름`);
      } else {
        if (d.id !== f.name) err(f, `id(${d.id})가 파일 이름과 다름`);
        if (m && typeof d.created === 'string' && !d.created.startsWith(idDate(m[1]))) {
          err(f, `ID 날짜(${idDate(m[1])})와 created(${d.created})가 다름`);
        }
      }
    }

    for (const k of ['created', 'updated']) {
      if (d[k] != null && !(typeof d[k] === 'string' && DATETIME.test(d[k]))) {
        err(f, `${k}는 2026-10-30T07:00 형식이어야 함 (지금: ${d[k]})`);
      }
    }
    if (d.dept != null && !depts.has(d.dept)) err(f, `없는 부서 "${d.dept}" — ${[...depts].join('·')}`);

    // 링크 칸
    for (const k of ['parent', 'decision', 'task']) {
      if (d[k] == null) continue;
      const t = linkTarget(d[k]);
      if (!t) err(f, `${k}는 "[[ID]]" 형식이어야 함 (지금: ${d[k]})`);
      else if (!byName.has(t)) err(f, `${k}가 가리키는 ${t}가 없음`);
    }

    if (d.type === '작업') checkTask(f, d, byName, err);
    if (d.type === '결정') checkDecision(f, d, byName, err);
    if (d.type === '하위') {
      if (f.rel !== `부서/${d.dept}/하위/${d.name}.md`) err(f, `하위 항목 파일은 부서/${d.dept}/하위/${d.name}.md 이어야 함`);
      if (d.order != null && !Number.isInteger(d.order)) err(f, 'order는 정수');
    }
    if (d.type === '작업' && d.unit != null && !units.has(`${d.dept}/${d.unit}`)) err(f, `${d.dept}에 하위 항목 "${d.unit}"이 없음`);
    // 하위 문서 commands: 이름 → PowerShell 명령 (또는 { run, confirm: true }) — 화면에서 버튼으로 돌린다
    if (d.type === '하위' && d.commands != null) {
      if (typeof d.commands !== 'object' || Array.isArray(d.commands)) err(f, 'commands는 이름 → 명령');
      else for (const [k, v] of Object.entries(d.commands)) {
        const run = typeof v === 'string' ? v : v?.run;
        if (typeof run !== 'string' || !run.trim()) err(f, `commands.${k}에 명령이 없음`);
      }
    }
    if ((d.type === '부서' || d.type === '하위') && d.match != null && (!Array.isArray(d.match) || d.match.some((m) => typeof m !== 'string' || !m.trim()))) err(f, 'match는 경로 조각 목록');
    if (d.type === '공정') {
      if (f.rel !== `부서/${d.dept}/공정/${d.name}.md`) err(f, `공정 파일은 부서/${d.dept}/공정/${d.name}.md 이어야 함`);
      if (!PROCESS_STATUS.includes(d.status)) err(f, `status "${d.status}" — ${PROCESS_STATUS.join('·')} 중 하나`);
      if (!Array.isArray(d.stages) || !d.stages.length || d.stages.some((s) => typeof s !== 'string' || !s.trim())) err(f, 'stages는 단계 이름 목록');
      else if (d.stage != null && !d.stages.includes(d.stage)) err(f, `stage "${d.stage}"가 stages에 없음`);
      if (d.unit != null && !units.has(`${d.dept}/${d.unit}`)) err(f, `${d.dept}에 하위 항목 "${d.unit}"이 없음`);
      if (d.order != null && !Number.isInteger(d.order)) err(f, 'order는 정수');
      // 실행 정의 (lib/pipeline.mjs): steps.<단계> = { do: 세션 지시 | cmd: 명령, group, gate }
      if (d.steps != null) {
        if (typeof d.steps !== 'object' || Array.isArray(d.steps)) err(f, 'steps는 단계 이름 → 정의');
        else for (const [k, v] of Object.entries(d.steps)) {
          if (Array.isArray(d.stages) && !d.stages.includes(k)) err(f, `steps의 "${k}"가 stages에 없음`);
          if (!v || typeof v !== 'object' || (typeof v.do !== 'string' && typeof v.cmd !== 'string' && v.check == null)) err(f, `steps.${k}에 do(세션 지시)·cmd(명령)·check(끝났다는 표시) 중 하나가 없음`);
          else if (v.check != null && ![].concat(v.check).every((c) => typeof c === 'string' && c.trim())) err(f, `steps.${k}.check는 경로 또는 경로 목록`);
          else if (v.gate != null && typeof v.gate !== 'boolean') err(f, `steps.${k}.gate는 true·false`);
        }
      }
      if (d.auto != null && typeof d.auto !== 'boolean') err(f, 'auto는 true·false');
      if (d.phase != null && !PROCESS_PHASE.includes(d.phase)) err(f, `phase "${d.phase}" — ${PROCESS_PHASE.join('·')} 중 하나`);
    }
    if (d.type === '기억카드') {
      if (!['사용', '버림'].includes(d.status)) err(f, 'status는 사용·버림');
      if (d.unit != null && !units.has(`${d.dept}/${d.unit}`)) err(f, `${d.dept}에 하위 항목 "${d.unit}"이 없음`);
    }
    if (d.type === '부서') {
      if (d.order != null && !Number.isInteger(d.order)) err(f, 'order는 정수');
      if (f.rel !== `부서/${d.name}/규칙.md`) err(f, `부서 파일은 부서/${d.name}/규칙.md 이어야 함`);
      if (d.workdir && !fs.existsSync(d.workdir)) warn(f, `작업 폴더가 없음: ${d.workdir}`);
    }
    if (d.type === '지표') checkMetrics(f, d, err);

    // 본문 링크는 경고만
    for (const m of f.body.matchAll(BODY_LINK)) {
      const t = m[1].trim();
      if (!byName.has(t)) warn(f, `본문 링크 [[${t}]]의 대상이 없음`);
    }
  }

  return { errors, warnings };
}

function checkTask(f, d, byName, err) {
  if (!TASK_STATUS.includes(d.status)) err(f, `status "${d.status}" — ${TASK_STATUS.join('·')} 중 하나`);
  if (d.status === '결정대기') {
    const t = linkTarget(d.decision);
    if (!t) err(f, '결정대기인데 decision 링크가 없음');
    else {
      const dec = byName.get(t);
      if (dec?.data && dec.data.status !== '대기') err(f, `결정대기인데 ${t}는 이미 "${dec.data.status}"`);
      if (dec?.data && linkTarget(dec.data.task) !== d.id) err(f, `${t}의 task가 이 작업을 가리키지 않음`);
    }
  }
  if (d.status === '대기예약' && !d.schedule) err(f, '대기예약인데 schedule이 없음');
  if (d.schedule != null && !parseSchedule(d.schedule)) err(f, `schedule "${d.schedule}" — 2026-10-31T07:00 또는 "매일 07:30"·"평일 09:00"·"주말 10:00"·"토요일 08:00"`);
  if (d.tags != null && !Array.isArray(d.tags)) err(f, 'tags는 목록([])이어야 함');
  for (const h of ['## 지시', '## 진행 로그', '## 결과']) {
    if (!f.body.includes(h)) err(f, `본문에 "${h}" 제목이 없음`);
  }
}

function checkDecision(f, d, byName, err) {
  if (!DECISION_STATUS.includes(d.status)) err(f, `status "${d.status}" — ${DECISION_STATUS.join('·')} 중 하나`);
  if (d.kind != null && !DECISION_KIND.includes(d.kind)) err(f, `kind "${d.kind}" — ${DECISION_KIND.join('·')} 중 하나`);
  const opts = d.options;
  if (!Array.isArray(opts) || opts.length < 2 || opts.length > 4 || !opts.every((o) => typeof o === 'string' && o.trim())) {
    err(f, 'options는 글 2~4개의 목록이어야 함');
    return;
  }
  const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= opts.length;
  if (d.recommended != null && !inRange(d.recommended)) err(f, `recommended는 1~${opts.length} 사이 번호`);
  if (d.choice != null && !inRange(d.choice)) err(f, `choice는 1~${opts.length} 사이 번호`);
  if (d.status === '결정됨' && d.choice == null) err(f, '결정됨인데 choice가 없음');
  if (d.status === '대기' && d.choice != null) err(f, 'choice가 있는데 status가 아직 대기');
  const task = byName.get(linkTarget(d.task));
  if (task?.data && task.data.type !== '작업') err(f, 'task가 작업 파일이 아님');
}

function checkMetrics(f, d, err) {
  if (!Array.isArray(d.metrics)) { err(f, 'metrics는 목록이어야 함'); return; }
  d.metrics.forEach((m, i) => {
    if (!m || typeof m.name !== 'string' || typeof m.current !== 'number' || typeof m.target !== 'number') {
      err(f, `metrics ${i + 1}번째: name(글)·current(숫자)·target(숫자)가 필요함`);
    }
  });
}
