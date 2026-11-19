// 시냅스: 보관함 밖의 참고 문서(md)와 그 폴더를 그래프에 붙인다.
//   부서 작업 폴더(workdir)를 훑어 md 파일과 md가 든 폴더를 점으로 만든다(읽기 전용).
//   트리  = 폴더 → 하위 폴더 → 문서. md 없이 한 갈래로만 이어지는 폴더는 이름을 합쳐 한 점으로 줄인다.
//   시냅스 = 문서가 적은 경로·md 링크·[[링크]]를 그 점으로 잇는다(절대·상대·끝부분 경로 모두).
// 폴더를 훑은 결과는 TTL 동안 재사용한다(화면이 1분 안에 바뀐 파일을 볼 필요는 없다).
import fs from 'node:fs';
import path from 'node:path';

const SKIP = /^(node_modules|\.git|\.github|venv.*|\.venv|__pycache__|_삭제대기|dist|site-packages|\.cache|third_party)$/i;
// 저장소 관리용 문서는 지식이 아니다
const SKIP_FILE = /^(code_of_conduct|contributing|license|security|pull_request_template|issue_template)(\.\w+)?\.md$/i;
const MAX_FILES = 4000;
const MAX_READ = 300_000;
const TTL = 5 * 60_000;   // 지나면 다음 요청은 옛 결과를 주고, 뒤에서 다시 훑는다
const GENERIC = /^(skill|index|claude|agents|changelog|notes)$/i;

export const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
export const keyOf = (p) => norm(p).toLowerCase();
const dirOf = (abs) => abs.slice(0, abs.lastIndexOf('/'));
const baseOf = (abs) => abs.slice(abs.lastIndexOf('/') + 1);
export const isExtId = (id) => typeof id === 'string' && (id.startsWith('ext:') || id.startsWith('dir:'));

// 문서에서 경로 후보 뽑기: `코드`, [글](경로), 맨 경로.md, [[이름]]
const CANDIDATES = [
  /`([^`\n]{3,240})`/g,
  /\]\(([^)\s]+)\)/g,
  /(?:^|[\s(])((?:[A-Za-z]:)?[^\s`'"()<>|[\]]*\.md)\b/gim,
  /\[\[([^\]|#]+)/g,
];
export function candidates(text) {
  const out = new Set();
  for (const re of CANDIDATES) for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}

function crawl(root) {
  const files = [];
  const dirs = new Map();
  function walk(d, depth) {
    if (depth > 14 || files.length >= MAX_FILES) return false;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return false; }
    const me = { abs: norm(d), files: [], subdirs: [] };
    // git으로 받아 온 남의 저장소는 README 하나로만 (엔진 하나 = 점 하나)
    const cloned = depth > 0 && ents.some((e) => e.name === '.git');
    for (const e of ents) {
      const abs = norm(path.join(d, e.name));
      if (e.isDirectory()) { if (!cloned && !SKIP.test(e.name) && walk(abs, depth + 1)) me.subdirs.push(abs); }
      else if (e.isFile() && /\.md$/i.test(e.name) && !SKIP_FILE.test(e.name) && (!cloned || /^readme\.md$/i.test(e.name)) && files.length < MAX_FILES) { me.files.push(abs); files.push(abs); }
    }
    me.subdirs.sort(); me.files.sort();
    const keep = me.files.length > 0 || me.subdirs.length > 0;
    if (keep) dirs.set(keyOf(d), me);
    return keep;
  }
  walk(root, 0);
  return { dirs, files };
}

const stamp = (ms) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// 루트 폴더 하나 → 점·트리·서로 간 링크
function scanRoot(root, dept) {
  root = norm(root);
  const { dirs } = crawl(root);
  const nodes = new Map();          // id → node
  const byPath = new Map();         // 경로(소문자) → id
  const bySeg = new Map();          // 마지막 이름(소문자) → [경로]
  const children = new Map();       // id → [id] (폴더 안)
  const index = (abs, id) => {
    const k = keyOf(abs);
    byPath.set(k, id);
    const seg = k.slice(k.lastIndexOf('/') + 1);
    (bySeg.get(seg) ?? bySeg.set(seg, []).get(seg)).push(k);
  };
  const addChild = (p, c) => { if (p) (children.get(p) ?? children.set(p, []).get(p)).push(c); };

  function addDir(abs, parent, prefix, aliases) {
    const d = dirs.get(keyOf(abs));
    const name = prefix ? `${prefix}/${baseOf(abs)}` : baseOf(abs);
    // md 없이 한 갈래로만 이어지는 폴더는 아래 폴더와 합친다 ("2. Tools/렌더엔진")
    if (abs !== root && d.files.length === 0 && d.subdirs.length === 1) return addDir(d.subdirs[0], parent, name, [...aliases, abs]);
    const id = `dir:${abs}`;
    const readme = d.files.find((f) => /^readme\.md$/i.test(baseOf(f))) ?? null;
    let st = null;
    try { st = fs.statSync(readme ?? abs); } catch { /* 없음 */ }
    nodes.set(id, { id, type: '폴더', title: name, dept, abs, readme, parent, bytes: st && readme ? st.size : 0, created: st ? stamp(st.birthtimeMs || st.mtimeMs) : null, time: st ? stamp(st.mtimeMs) : null });
    addChild(parent, id);
    index(abs, id);
    for (const a of aliases) index(a, id);
    if (readme) index(readme, id);
    for (const f of d.files) {
      if (f === readme) continue;
      const fid = `ext:${f}`;
      const stem = baseOf(f).replace(/\.md$/i, '');
      let fs1 = null;
      try { fs1 = fs.statSync(f); } catch { /* 없음 */ }
      nodes.set(fid, { id: fid, type: '참고', title: GENERIC.test(stem) ? `${baseOf(abs)}/${stem}` : stem, dept, abs: f, parent: id, bytes: fs1?.size ?? 0, created: fs1 ? stamp(fs1.birthtimeMs || fs1.mtimeMs) : null, time: fs1 ? stamp(fs1.mtimeMs) : null });
      addChild(id, fid);
      index(f, fid);
    }
    for (const s of d.subdirs) addDir(s, id, '', []);
    return id;
  }
  const rootId = dirs.has(keyOf(root)) ? addDir(root, null, '', []) : null;

  // 경로 글자 하나 → 점 id (못 찾으면 null). exact면 실제로 있는 파일의 가까운 폴더로 돌려 대지 않는다
  function resolve(raw, fromDir, exact = false) {
    let p = String(raw).trim().replace(/^["'`]+|["'`,;:)]+$/g, '');
    p = norm(p.split(/[<*?|>]/)[0].trim());
    if (p.length < 3 || /^https?:/i.test(p) || /\s-{1,2}\w/.test(p)) return null;
    try { p = decodeURIComponent(p); } catch { /* 그대로 */ }
    const near = (abs) => {           // 있는 파일이면 가장 가까운 점(폴더)으로
      if (exact || !keyOf(abs).startsWith(`${keyOf(root)}/`) || !fs.existsSync(abs)) return null;
      for (let a = abs; a.length > root.length; a = dirOf(a)) { const hit = byPath.get(keyOf(a)); if (hit) return hit === rootId ? null : hit; }
      return null;
    };
    if (/^[a-z]:\//i.test(p)) return byPath.get(keyOf(p)) ?? (p.includes('/') ? near(p) : null);
    for (const base of [fromDir, root]) {
      if (!base) continue;
      const abs = path.posix.normalize(`${base}/${p}`);
      const hit = byPath.get(keyOf(abs));
      if (hit) return hit;
    }
    // 끝부분이 맞는 경로가 하나뿐이면 그것 ("상시/공통/도구_기능대장.md", "gf-shorts-guide.md")
    const k = keyOf(p).replace(/^\.\//, '');
    const seg = k.slice(k.lastIndexOf('/') + 1);
    if (!seg.includes('.') && !k.includes('/')) return null;   // 맨 낱말은 링크로 치지 않는다
    const list = (bySeg.get(seg) ?? bySeg.get(`${seg}.md`) ?? []).filter((x) => x === k || x.endsWith(`/${k}`) || x.endsWith(`/${k}.md`));
    if (list.length === 1) return byPath.get(list[0]);
    if (k.includes('/')) return near(path.posix.normalize(`${root}/${p}`));
    return null;
  }

  // 참고 문서끼리의 시냅스
  const links = [];
  for (const n of nodes.values()) {
    const file = n.type === '참고' ? n.abs : n.readme;
    if (!file) continue;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8').slice(0, MAX_READ); } catch { continue; }
    const from = dirOf(file);
    for (const c of candidates(text)) {
      const t = resolve(c, from);
      if (t && t !== n.id) links.push([n.id, t]);
    }
  }
  return { root, dept, rootId, nodes, children, links, resolve };
}

const scans = new Map();   // 루트 → { at, data }
let generation = 0;

// roots: [{ root, dept }] — 같은 폴더를 두 부서가 쓰면 앞의 부서
export function synapse(roots) {
  const seen = new Set();
  const list = [];
  for (const { root, dept } of roots) {
    const k = keyOf(root);
    if (seen.has(k)) continue;
    seen.add(k);
    let hit = scans.get(k);
    if (!hit || hit.data.dept !== dept) {
      hit = { at: Date.now(), data: scanRoot(root, dept) };
      scans.set(k, hit);
      generation += 1;
    } else if (Date.now() - hit.at > TTL && !hit.busy) {
      hit.busy = true;   // 오래됐으면 지금은 옛 결과로 답하고 뒤에서 다시 훑는다
      setTimeout(() => { scans.set(k, { at: Date.now(), data: scanRoot(root, dept) }); generation += 1; }, 0);
    }
    list.push(hit.data);
  }
  const node = (id) => { for (const s of list) { const n = s.nodes.get(id); if (n) return n; } return null; };
  return {
    gen: generation,
    scans: list,
    node,
    // 보관함 문서처럼 어느 루트에도 속하지 않은 글에서 경로를 찾는다
    resolve: (raw, fromDir = null, exact = false) => { for (const s of list) { const t = s.resolve(raw, fromDir, exact); if (t) return t; } return null; },
    children: (id) => { for (const s of list) { const c = s.children.get(id); if (c) return c; } return []; },
  };
}

// 화면에 보일 문서 본문: [글](경로.md)는 [[점|글]]로 바꾸고, `경로` 코드는 refs로 알려 준다
export function linkify(syn, body, fromDir = null) {
  const refs = {};
  for (const m of body.matchAll(/`([^`\n]{3,240})`/g)) {
    const t = syn.resolve(m[1], fromDir);
    if (t) refs[m[1]] = t;
  }
  const text = body.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (all, label, href) => {
    if (/^https?:/i.test(href)) return all;
    const t = syn.resolve(href, fromDir);
    return t ? `[[${t}|${label}]]` : all;
  });
  return { text, refs };
}

// 참고 문서·폴더 하나를 문서 화면용으로
export function extDoc(syn, id) {
  const n = syn.node(id);
  if (!n) return null;
  const file = n.type === '참고' ? n.abs : n.readme;
  let raw = '';
  if (file) { try { raw = fs.readFileSync(file, 'utf8'); } catch { raw = ''; } }
  let body = raw.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  if (n.type === '폴더') {
    const kids = syn.children(id).map(syn.node).filter(Boolean);
    const dirsFirst = [...kids.filter((k) => k.type === '폴더'), ...kids.filter((k) => k.type !== '폴더')];
    if (kids.length) body += `${body.trim() ? '\n\n---\n\n' : ''}## 이 폴더 (${kids.length})\n\n${dirsFirst.map((k) => `- [[${k.id}|${k.type === '폴더' ? `${k.title}/` : k.title}]]`).join('\n')}\n`;
  }
  const { text, refs } = linkify(syn, body, file ? dirOf(file) : n.abs);
  return {
    name: id, rel: file ?? n.abs, readonly: true, raw,
    data: { type: n.type, title: n.title, dept: n.dept, path: n.abs },
    body: text, refs,
  };
}
