// 보관함 쓰기. 서버 안의 모든 쓰기는 이 모듈을 거쳐 한 줄로 처리된다(같은 파일을 동시에 고치지 않게).
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadVault, checkVault, splitFrontmatter, linkTarget } from './vault.mjs';

const pad = (n, w = 2) => String(n).padStart(w, '0');

// 2026-10-30T07:05 (이 PC의 현지 시각)
export function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const yymmdd = (d) => `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

// 칸 순서를 템플릿과 같게 유지
const ORDER = {
  작업: ['type', 'id', 'title', 'dept', 'unit', 'status', 'created', 'updated', 'session', 'schedule', 'last_run', 'parent', 'decision', 'tags'],
  결정: ['type', 'id', 'title', 'task', 'dept', 'status', 'kind', 'created', 'options', 'recommended', 'choice', 'note'],
  보고서: ['type', 'id', 'title', 'dept', 'task', 'created', 'tags'],
  기억카드: ['type', 'id', 'rule', 'dept', 'unit', 'status', 'created', 'updated', 'sources', 'decision'],
};

function ordered(data) {
  const keys = ORDER[data.type] ?? Object.keys(data);
  const out = {};
  for (const k of keys) if (k in data) out[k] = data[k];
  for (const k of Object.keys(data)) if (!(k in out)) out[k] = data[k];
  return out;
}

const link = (id) => (id ? `[[${id}]]` : null);
// 작업 제목: 지시의 첫 문장만, 40자 안쪽 (넘으면 낱말 경계에서 자르고 …)
export function shortTitle(text) {
  const first = String(text).trim().split('\n')[0].trim();
  const sentence = first.match(/^(.+?[.?!。])(\s|$)/)?.[1] ?? first;
  const s = sentence.replace(/[.。]$/, '').trim();
  if (s.length <= 40) return s;
  const cut = s.slice(0, 40);
  const at = cut.lastIndexOf(' ');
  return `${(at > 20 ? cut.slice(0, at) : cut).trim()}…`;
}

export const TASK_SECTIONS = ['지시', '진행 로그', '결과'];
// 작업의 칸(## 지시 · ## 진행 로그 · ## 결과) 안에서는 머리말이 ### 아래여야 한다.
//   세션이 결과에 ## 제목을 쓰면 칸이 거기서 끊긴다 — 가장 큰 머리말이 ###가 되게 전부 같은 만큼 내린다 (코드 블록 안은 그대로)
export function demoteHeadings(text, top = 3) {
  const lines = String(text).split('\n');
  let fence = false;
  const heads = [];
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    else if (!fence && /^#{1,6}\s/.test(l)) heads.push(i);
  });
  const min = Math.min(...heads.map((i) => lines[i].match(/^#+/)[0].length));
  const shift = heads.length ? Math.max(0, top - min) : 0;
  if (!shift) return String(text);
  for (const i of heads) lines[i] = lines[i].replace(/^#+/, (h) => '#'.repeat(Math.min(6, h.length + shift)));
  return lines.join('\n');
}

// 작업 결과 본문: 요약 + "### 결과물"(절대 경로 · 보고서 링크) — submit_result가 쓴다
export function resultText(summary, paths = [], reports = []) {
  const outs = [...paths.map((p) => `- \`${p}\``), ...reports.map((r) => `- [[${r}]]`)];
  return [demoteHeadings(String(summary).trim()), ...(outs.length ? ['', '### 결과물', '', ...outs] : [])].join('\n');
}

// 기억 카드 규칙: 한 줄, 300자까지
const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' ').trim().slice(0, 300);

export class StoreError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function createStore(root, { now = () => new Date(), onWrite = () => {} } = {}) {
  let chain = Promise.resolve();
  // 쓰기를 차례로 실행
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const abs = (rel) => path.join(root, rel);
  // 보관함 읽기는 비싸서(파일마다 YAML) 한 번 읽어 두고, 쓰거나 파일이 바뀌면 버린다
  let cache = null;
  const files = () => (cache ??= loadVault(root).files);
  const invalidate = () => { cache = null; };
  // 템플릿은 실제 문서가 아니다
  const docs = () => files().filter((f) => !f.rel.startsWith('템플릿/'));

  function read(rel) {
    const file = abs(rel);
    if (!fs.existsSync(file)) throw new StoreError(`${rel} 없음`, 404);
    const fm = splitFrontmatter(fs.readFileSync(file, 'utf8'));
    if (!fm) throw new StoreError(`${rel}: frontmatter 없음`, 500);
    return { data: parseYaml(fm.yaml) ?? {}, body: fm.body };
  }

  function write(rel, data, body) {
    const file = abs(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = `---\n${stringifyYaml(ordered(data), { lineWidth: 0 })}---\n${body}`;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    invalidate();
    onWrite(rel);
  }

  function nextId(prefix, dir, date) {
    const head = `${prefix}-${yymmdd(date)}-`;
    let max = 0;
    const d = abs(dir);
    if (fs.existsSync(d)) {
      for (const name of fs.readdirSync(d)) {
        if (name.startsWith(head) && name.endsWith('.md')) max = Math.max(max, Number(name.slice(head.length, -3)) || 0);
      }
    }
    return `${head}${pad(max + 1, 3)}`;
  }

  const taskRel = (id) => `작업/${id}.md`;
  const decisionRel = (id) => `결정/${id}.md`;

  // "## 제목" 아래 내용을 바꾸거나 덧붙인다
  function editSection(body, heading, fn) {
    const lines = body.split('\n');
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start < 0) return `${body.replace(/\s*$/, '')}\n\n## ${heading}\n\n${fn('')}\n`;
    // 작업 칸은 다음 작업 칸 머리말에서 끝난다 — 예전 결과 안에 세션이 쓴 "## 제목"은 칸의 끝이 아니다
    const known = TASK_SECTIONS.includes(heading);
    let end = lines.findIndex((l, i) => i > start && l.startsWith('## ') && (!known || TASK_SECTIONS.includes(l.slice(3).trim())));
    if (end < 0) end = lines.length;
    const current = lines.slice(start + 1, end).join('\n').trim();
    const next = fn(current);
    return [...lines.slice(0, start + 1), '', next, '', ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // 부서는 번호(order) 순서: 01 비서실 … 99 비정규직
  const byOrder = (a, b) => (a.order ?? 50) - (b.order ?? 50) || String(a.name).localeCompare(String(b.name));
  function depts() {
    return docs()
      .filter((f) => f.data?.type === '부서')
      .map((f) => ({ ...f.data, rules: f.body.trim(), file: f.abs }))
      .sort(byOrder);
  }

  // 부서 안의 하위 항목 (부서/<부서>/하위/<이름>.md)
  function units(deptName) {
    return docs()
      .filter((f) => f.data?.type === '하위' && (!deptName || f.data.dept === deptName))
      .map((f) => ({ ...f.data, rules: f.body.trim(), id: `하위:${f.data.dept}/${f.data.name}` }))
      .sort(byOrder);
  }

  // 하위 항목의 작업 프로세스 (부서/<부서>/공정/<이름>.md) — 지도에 늘 뜨는 공정 카드
  function processes() {
    return docs()
      .filter((f) => f.data?.type === '공정')
      .map((f) => ({ ...f.data, id: f.name, title: f.data.title ?? f.data.name }))
      .sort(byOrder);
  }

  // 공정 문서 고치기 (실행기가 단계·상태를 적는다). 값이 undefined인 칸은 지운다
  function patchProcess(name, patch) {
    return serial(() => {
      const p = processes().find((x) => x.id === name);
      if (!p) throw new StoreError(`없는 공정: ${name}`, 404);
      const rel = `부서/${p.dept}/공정/${name}.md`;
      const { data, body } = read(rel);
      const next = { ...data, ...patch, updated: stamp(now()) };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      write(rel, next, body);
      return { ...next, id: name, title: next.title ?? next.name };
    });
  }

  // 하위·공정 문서 쓰기: 있으면 준 칸만 바꾸고(null이면 지움), 없으면 새로. body가 있으면 본문도 바꾼다
  const NAME_BAD = /[\\/:*?"<>|#[\]]/;
  const UNIT_KEYS = ['summary', 'order', 'color', 'workdir', 'match', 'commands'];
  const PROC_KEYS = ['unit', 'title', 'summary', 'order', 'status', 'stages', 'stage', 'item', 'slug', 'workdir', 'steps', 'auto'];
  function saveDoc(type, x) {
    const deptName = String(x.dept ?? '').trim();
    dept(deptName);
    const name = String(x.name ?? '').trim();
    if (!name || NAME_BAD.test(name)) throw new StoreError(`${type} 이름이 비었거나 쓸 수 없는 글자가 있음`);
    const rel = type === '하위' ? `부서/${deptName}/하위/${name}.md` : `부서/${deptName}/공정/${name}.md`;
    const file = abs(rel);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const cur = before != null ? read(rel) : { data: {}, body: '' };
    const keys = type === '하위' ? UNIT_KEYS : PROC_KEYS;
    const data = { ...cur.data, type, name, dept: deptName };
    for (const k of keys) if (x[k] !== undefined) data[k] = x[k];
    for (const k of Object.keys(data)) if (data[k] === null) delete data[k];
    if (type === '하위' && data.order == null) data.order = Math.max(0, ...units(deptName).map((u) => u.order ?? 0)) + 1;
    if (type === '공정') {
      data.status ??= '정지';
      if (data.stage && Array.isArray(data.stages) && !data.stages.includes(data.stage)) delete data.stage;
      data.updated = stamp(now());
    }
    const body = x.body != null ? `${String(x.body).trim()}\n` : before != null ? cur.body : `# ${data.title ?? name}\n\n${data.summary ?? ''}\n`;
    write(rel, data, body);
    const errs = checkVault(loadVault(root)).errors.filter((e) => e.startsWith(`${rel}:`));
    if (errs.length) {
      if (before != null) { fs.writeFileSync(file, before); invalidate(); } else { fs.unlinkSync(file); invalidate(); }   // 방금 새로 만든 잘못된 파일만 지운다
      throw new StoreError(`형식 오류로 되돌림 — ${errs.map((e) => e.slice(rel.length + 2)).join(' / ')}`);
    }
    return { id: type === '하위' ? `하위:${deptName}/${name}` : name, rel, created: before == null };
  }

  function dept(name) {
    const d = depts().find((x) => x.name === name);
    if (!d) throw new StoreError(`없는 부서: ${name}`);
    return d;
  }

  function readTask(id) {
    const t = read(taskRel(id));
    return { ...t, file: abs(taskRel(id)) };
  }

  function patchTaskSync(id, patch, bodyFn) {
    const { data, body } = read(taskRel(id));
    const next = { ...data, ...patch, updated: stamp(now()) };
    write(taskRel(id), next, bodyFn ? bodyFn(body) : body);
    return next;
  }

  return {
    root,
    files,
    patchProcess,
    invalidate,
    depts,
    dept,
    readTask,
    readDecision: (id) => read(decisionRel(id)),

    createTask: ({ dept: deptName, unit = null, title, instruction, parent = null, status = '실행중', schedule = null, tags = [] }) => serial(() => {
      dept(deptName);
      if (unit && !units(deptName).some((u) => u.name === unit)) throw new StoreError(`${deptName}에 하위 항목 "${unit}"이 없음`);
      if (!instruction?.trim()) throw new StoreError('지시(instruction)가 비었음');
      const t = now();
      const id = nextId('W', '작업', t);
      const name = title?.trim() ? title.trim().slice(0, 60) : shortTitle(instruction);
      const data = {
        type: '작업', id, title: name, dept: deptName, unit: unit || null, status, created: stamp(t), updated: stamp(t),
        session: null, schedule, parent: link(parent), decision: null, tags,
      };
      write(taskRel(id), data, `## 지시\n\n${instruction.trim()}\n\n## 진행 로그\n\n- ${hhmm(t)} 작업 생성\n\n## 결과\n`);
      return id;
    }),

    patchTask: (id, patch) => serial(() => patchTaskSync(id, patch)),

    // 이름 바꾸기: 한 줄로 다듬어 title만 바꾸고 진행 로그에 남긴다 (같은 이름이면 그대로)
    renameTask: (id, title, who = '사용자가') => serial(() => {
      const name = String(title ?? '').replace(/\s+/g, ' ').trim();
      if (!name) throw new StoreError('title이 비었음');
      if (name.length > 60) throw new StoreError(`이름은 60자까지 (지금 ${name.length}자)`);
      const before = read(taskRel(id)).data.title;
      if (before === name) return { before, title: name, changed: false };
      const line = `- ${hhmm(now())} ${who} 이름 변경 → ${name} (전: ${before})`;
      patchTaskSync(id, { title: name }, (body) => editSection(body, '진행 로그', (cur) => (cur ? `${cur}\n${line}` : line)));
      return { before, title: name, changed: true };
    }),

    // 기억 쌓기: 기억/<주인말|검수>-YYYY-MM-DD.md 의 "## 기록"에 한 줄 덧붙인다 (없으면 만든다)
    appendMemory: (kind, text) => serial(() => {
      const KIND = { 주인말: { type: '주인말', prefix: '주인말-', title: '주인 말', about: '사람이 화면에서 한 말 — 새 일 지시, 이어 시키기, 결정과 메모, 기억에 한 질문.' },
        검수: { type: '검수판정', prefix: '검수-', title: '검수 판정', about: '사람이 검수에서 내린 판정 — 완료 확인, 다시 열기(이유), 취소.' } }[kind];
      if (!KIND) throw new StoreError(`기억 종류는 주인말·검수 (지금: ${kind})`);
      const t = now();
      const date = stamp(t).slice(0, 10);
      const rel = `기억/${KIND.prefix}${date}.md`;
      const file = abs(rel);
      if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, [
          '---', `type: ${KIND.type}`, `date: ${date}`, '---',
          `# ${KIND.title} · ${date}`, '',
          `${KIND.about} 서버가 자동으로 쌓는다. 고치지 않는다 — 기억 카드의 재료.`, '',
          '## 기록', '',
        ].join('\n'));
      }
      const line = `- ${hhmm(t)} ${String(text).replace(/\s*\n\s*/g, ' ').trim().slice(0, 600)}`;
      fs.appendFileSync(file, `${fs.readFileSync(file, 'utf8').endsWith('\n') ? '' : '\n'}${line}\n`);
      invalidate();
      onWrite(rel);
      return rel;
    }),

    appendLog: (id, text) => serial(() => {
      const line = `- ${hhmm(now())} ${String(text).replace(/\s*\n\s*/g, ' ').trim()}`;
      return patchTaskSync(id, {}, (body) => editSection(body, '진행 로그', (cur) => (cur ? `${cur}\n${line}` : line)));
    }),

    setResult: (id, text, status = '검수') => serial(() => {
      return patchTaskSync(id, { status }, (body) => editSection(body, '결과', () => demoteHeadings(text.trim())));
    }),

    createDecision: ({ task, title, options, recommended = null, background = '', kind = '선택' }) => serial(() => {
      const t = readTask(task).data;
      if (!Array.isArray(options) || options.length < 2 || options.length > 4) throw new StoreError('선택지는 2~4개');
      if (recommended != null && !(recommended >= 1 && recommended <= options.length)) recommended = null;
      const time = now();
      const id = nextId('D', '결정', time);
      write(decisionRel(id), {
        type: '결정', id, title, task: link(task), dept: t.dept, status: '대기', kind, created: stamp(time),
        options, recommended, choice: null, note: null,
      }, `## 배경\n\n${background.trim() || '(없음)'}\n`);
      patchTaskSync(task, { status: '결정대기', decision: link(id) },
        (body) => editSection(body, '진행 로그', (cur) => `${cur}\n- ${hhmm(time)} 결정 요청 [[${id}]] ${title}`.trim()));
      return id;
    }),

    answerDecision: (id, choice, note = null) => serial(() => {
      const { data, body } = read(decisionRel(id));
      if (data.status !== '대기') throw new StoreError(`${id}는 이미 결정됨`, 409);
      if (!Number.isInteger(choice) || choice < 1 || choice > data.options.length) {
        throw new StoreError(`choice는 1~${data.options.length}`);
      }
      const next = { ...data, status: '결정됨', choice, note: note?.trim() || null };
      write(decisionRel(id), next, body);
      const taskId = linkTarget(data.task);
      const task = read(taskRel(taskId)).data;
      const resume = task.status === '결정대기' && linkTarget(task.decision) === id;
      patchTaskSync(taskId, resume ? { status: '실행중' } : {},
        (b) => editSection(b, '진행 로그', (cur) => `${cur}\n- ${hhmm(now())} [[${id}]] → ${choice}번 "${data.options[choice - 1]}"${next.note ? ` (메모: ${next.note})` : ''}`.trim()));
      return { decision: next, taskId };
    }),

    // 기억 카드: 사람이 승인한 규칙 한 줄 (dept·unit이 없으면 모든 부서)
    listCards: () => docs().filter((f) => f.data?.type === '기억카드').map((f) => ({ ...f.data, body: f.body })).sort((a, b) => b.id.localeCompare(a.id)),
    createCard: ({ rule, dept: deptName = null, unit = null, sources = [], why = '', decision = null }) => serial(() => {
      if (!String(rule ?? '').trim()) throw new StoreError('규칙(rule)이 비었음');
      if (deptName) dept(deptName);
      if (unit && !units(deptName).some((u) => u.name === unit)) unit = null;
      const t = now();
      const id = nextId('K', '기억/카드', t);
      const one = oneLine(rule);
      write(`기억/카드/${id}.md`, {
        type: '기억카드', id, rule: one, dept: deptName || null, unit: unit || null, status: '사용', created: stamp(t),
        sources: sources.map((s) => link(String(s).replace(/^\[\[|\]\]$/g, '').trim())).filter(Boolean), decision: link(decision),
      }, ['## 규칙', '', one, '', '## 근거', '', String(why).trim() || '(없음)', ''].join('\n'));
      return id;
    }),
    patchCard: (id, patch) => serial(() => {
      const rel = `기억/카드/${id}.md`;
      const { data, body } = read(rel);
      const next = { ...data, updated: stamp(now()) };
      if (patch.rule != null) {
        if (!String(patch.rule).trim()) throw new StoreError('규칙이 비었음');
        next.rule = oneLine(patch.rule);
      }
      if (patch.status != null) {
        if (!['사용', '버림'].includes(patch.status)) throw new StoreError('status는 사용·버림');
        next.status = patch.status;
      }
      write(rel, next, patch.rule != null ? editSection(body, '규칙', () => next.rule) : body);
      return next;
    }),

    createReport: ({ dept: deptName, task = null, title, conclusions = [], body, sources = [] }) => serial(() => {
      dept(deptName);
      const t = now();
      const id = nextId('R', '보고서', t);
      const text = [
        '## 결론', '', ...conclusions.map((c, i) => `${i + 1}. ${c}`), '',
        '## 본문', '', body.trim(), '',
        '## 출처', '', ...(sources.length ? sources.map((s) => `- ${s}`) : ['(없음)']), '',
      ].join('\n');
      write(`보고서/${id}.md`, { type: '보고서', id, title, dept: deptName, task: link(task), created: stamp(t), tags: [] }, text);
      return id;
    }),

    // 이름(파일 이름)으로 문서 찾기 — 화면의 [[링크]] 열기용
    findDoc: (name) => {
      // 부서·하위 항목은 그래프 ID로도 연다: "부서:영상편집부", "하위:영상편집부/몬티"
      const rel = name.startsWith('부서:') ? `부서/${name.slice(3)}/규칙.md`
        : name.startsWith('하위:') ? `부서/${name.slice(3).split('/')[0]}/하위/${name.slice(3).split('/').slice(1).join('/')}.md` : null;
      const f = rel ? docs().find((x) => x.rel === rel) : docs().find((x) => x.name === name && x.name !== '규칙' && !x.rel.includes('/하위/'));
      if (!f) throw new StoreError(`${name} 없음`, 404);
      return { name: f.name, rel: f.rel, data: f.data, body: f.body, raw: fs.readFileSync(f.abs, 'utf8') };
    },

    // 사람이 화면에서 고친 원문 저장. 형식 검사(check)가 오류를 내면 되돌린다
    writeRaw: (rel, raw, check) => serial(() => {
      const file = abs(rel);
      const before = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, raw.replace(/\r\n/g, '\n'));
      invalidate();
      const errors = check().filter((e) => e.startsWith(`${rel}:`));
      if (errors.length) {
        fs.writeFileSync(file, before);
        invalidate();
        throw new StoreError(errors.map((e) => e.slice(rel.length + 2)).join('\n'));
      }
      onWrite(rel);
    }),

    units,
    processes,
    createUnit: ({ dept: deptName, name, summary = '' }) => serial(() => {
      dept(deptName);
      const clean = String(name ?? '').trim();
      if (!clean || /[\\/:*?"<>|#[\]]/.test(clean)) throw new StoreError('하위 항목 이름이 비었거나 쓸 수 없는 글자가 있음');
      if (units(deptName).some((u) => u.name === clean)) throw new StoreError(`${deptName}에 "${clean}"이 이미 있음`, 409);
      const order = Math.max(0, ...units(deptName).map((u) => u.order ?? 0)) + 1;
      const rel = `부서/${deptName}/하위/${clean}.md`;
      write(rel, { type: '하위', name: clean, dept: deptName, order, summary: summary.trim() || null }, `# ${clean}\n\n${summary.trim()}\n`);
      return `하위:${deptName}/${clean}`;
    }),

    // 하위 항목 만들기·고치기 (비서실 세션의 save_unit, 화면). 쓴 뒤 형식 검사에 걸리면 되돌리고 오류를 던진다
    saveUnit: (u) => serial(() => saveDoc('하위', u)),
    // 공정 만들기·고치기 (save_process). 실행기가 적는 phase·run과 아직 맞는 stage는 그대로 둔다
    saveProcess: (p) => serial(() => saveDoc('공정', p)),

    listReports: () => docs().filter((f) => f.data?.type === '보고서').map((f) => f.data),
    listJournals: () => docs().filter((f) => f.data?.type === '일지').map((f) => ({ ...f.data, name: f.name })),

    // 화면용 목록
    listTasks: () => docs().filter((f) => f.data?.type === '작업').map((f) => f.data),
    listDecisions: () => docs().filter((f) => f.data?.type === '결정').map((f) => f.data),
    kpi: () => {
      try { return read('지표/KPI.md').data.metrics ?? []; } catch { return []; }
    },
  };
}
