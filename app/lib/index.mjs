// 역링크와 전체 검색. 보관함 파일이 바뀌면 다시 만든다.
import fs from 'node:fs';
import { loadVault } from './vault.mjs';
import { candidates, keyOf, norm, synapse } from './synapse.mjs';

const LINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

// all: 이미 읽어 둔 보관함 파일 (없으면 직접 읽는다)
export function buildIndex(root, all = loadVault(root).files) {
  const files = all.filter((f) => !f.rel.startsWith('템플릿/'));
  const backlinks = new Map(); // 대상 이름 → [{ from, rel }]
  for (const f of files) {
    const text = `${JSON.stringify(f.data ?? {})}\n${f.body}`;
    const seen = new Set();
    for (const m of text.matchAll(LINK)) {
      const target = m[1].trim();
      if (target === f.name || seen.has(target)) continue;
      seen.add(target);
      if (!backlinks.has(target)) backlinks.set(target, []);
      backlinks.get(target).push({ from: f.name, rel: f.rel, type: f.data?.type ?? null, title: f.data?.title ?? f.name });
    }
  }

  function search(q, limit = 30) {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out = [];
    for (const f of files) {
      const hay = `${f.data?.title ?? ''}\n${f.body}`;
      const at = hay.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const s = Math.max(0, at - 40);
      out.push({
        name: f.name, rel: f.rel, type: f.data?.type ?? null, title: f.data?.title ?? f.name,
        snippet: hay.slice(s, at + needle.length + 60).replace(/\s+/g, ' ').trim(),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // 시냅스로 붙일 바깥 폴더: 부서 작업 폴더 중 보관함과 겹치지 않는 것
  const vaultKey = keyOf(root);
  const roots = files
    .filter((f) => f.data?.type === '부서' && typeof f.data.workdir === 'string')
    .sort((a, b) => (a.data.order ?? 50) - (b.data.order ?? 50))
    .map((f) => ({ root: norm(f.data.workdir), dept: f.data.name }))
    .filter((r) => {
      const k = keyOf(r.root);
      return fs.existsSync(r.root) && k !== vaultKey && !vaultKey.startsWith(`${k}/`) && !k.startsWith(`${vaultKey}/`);
    });
  const syn = () => synapse(roots);
  let memo = null;
  const graph = () => {
    const s = syn();
    if (!memo || memo.gen !== s.gen) memo = { gen: s.gen, g: buildGraph(files, s) };
    return memo.g;
  };

  return { backlinks: (name) => backlinks.get(name) ?? [], search, graph, syn };
}

// 그래프:
//   점 = 보관함의 md 파일 하나 + 부서 작업 폴더의 참고 문서·폴더(시냅스). 아직 없는 문서를 가리키는 [[링크]]는 "유령", 태그는 "태그".
//   가운데는 비서실장. 비서실장 → 부서 → 하위 항목 → 작업·참고 폴더 → 문서 … 로 이어지는 트리를 선(tree)으로도 긋고,
//   점마다 그 트리의 깊이(depth)를 준다 — 화면은 깊이가 깊을수록 점을 작게, 바깥 고리에 놓는다.
//   선 = 트리 + [[링크]](본문과 frontmatter) + 문서가 적은 경로(시냅스). 같은 두 점 사이 선은 하나만.
export const ME = 'me';
export const CHIEF = '비서실장';
const deptId = (name) => `부서:${name}`;
const unitId = (dept, name) => `하위:${dept}/${name}`;
const TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;

function buildGraph(files, syn) {
  const nodes = [];
  const byName = new Map();
  for (const f of files) {
    const d = f.data ?? {};
    const isRules = f.rel === 'CLAUDE.md';
    if (!d.type && !isRules) continue;
    const id = d.type === '부서' ? deptId(d.name) : d.type === '하위' ? unitId(d.dept, d.name) : isRules ? 'CLAUDE' : f.name;
    let st = null;
    try { st = fs.statSync(f.abs); } catch { /* 지워진 사이 */ }
    const node = {
      id, file: f.rel, type: isRules ? '노트' : d.type,
      title: isRules ? '공통 규칙' : ['부서', '하위', '총괄'].includes(d.type) ? d.name : d.type === '기억카드' ? String(d.rule ?? f.name).slice(0, 48) : d.type === '주인말' ? `주인 말 ${d.date}` : d.type === '검수판정' ? `검수 판정 ${d.date}` : d.type === '세션지시' ? `세션 지시 ${d.date}` : d.type === '배움' ? `배움 ${d.date}` : d.title ?? (d.type === '지표' ? '목표 지표' : f.name),
      dept: d.type === '부서' ? d.name : d.dept ?? null, unit: d.unit ?? null, order: d.order ?? null, status: d.status ?? null, kind: d.kind ?? null,
      color: d.type === '부서' ? d.color ?? null : null,
      time: d.updated ?? d.created ?? d.date ?? null,
      created: d.created ?? d.date ?? (st ? new Date(st.birthtimeMs || st.mtimeMs).toISOString().slice(0, 16) : null),
      bytes: st?.size ?? 0,
    };
    nodes.push(node);
    byName.set(id, { node, f });
  }
  // 시냅스 점 (보관함 밖 참고 문서·폴더)
  const ext = new Map();
  for (const s of syn.scans) {
    for (const n of s.nodes.values()) {
      ext.set(n.id, {
        id: n.id, file: n.readme ?? n.abs, type: n.type, title: n.title, dept: n.dept, unit: null, order: null, status: null, kind: null, color: null,
        time: n.time, created: n.created, bytes: n.bytes, parent: n.parent ?? `부서:${n.dept}`,
      });
    }
  }

  const has = (id) => !!id && (byName.has(id) || ext.has(id));
  const linkOf = (v) => (typeof v === 'string' ? v.match(/^\[\[([^\]|#]+)/)?.[1]?.trim() ?? null : null);
  const chief = byName.has(CHIEF) ? CHIEF : ME;

  // 트리 부모 (왼쪽 트리와 지도 고리)
  for (const { node, f } of byName.values()) {
    const d = f.data ?? {};
    let parent = chief;
    if (node.type === '총괄') parent = ME;
    else if (node.type === '하위') parent = deptId(d.dept);
    else if (node.type === '작업') parent = has(linkOf(d.parent)) ? linkOf(d.parent) : d.unit && has(unitId(d.dept, d.unit)) ? unitId(d.dept, d.unit) : deptId(d.dept);
    else if (node.type === '결정' || node.type === '보고서') parent = has(linkOf(d.task)) ? linkOf(d.task) : deptId(d.dept);
    else if (node.type === '공정') parent = d.unit && has(unitId(d.dept, d.unit)) ? unitId(d.dept, d.unit) : deptId(d.dept);
    else if (node.type === '기억카드') parent = d.unit && has(unitId(d.dept, d.unit)) ? unitId(d.dept, d.unit) : d.dept ? deptId(d.dept) : chief;
    node.parent = parent === ME || has(parent) ? parent : chief;
  }

  // 보관함 문서가 적은 경로 → 시냅스. 하위 항목이 가리킨 폴더·문서는 그 하위 항목 아래로 옮겨 단다
  const refs = [];
  const found = new Map();
  for (const { node, f } of byName.values()) {
    const d = f.data ?? {};
    const mine = new Set();
    const texts = [...candidates(f.body), ...(node.type === '하위' && typeof d.workdir === 'string' ? [d.workdir] : [])];
    const exact = new Set();
    for (const c of texts) {
      const t = syn.resolve(c);
      if (t && ext.has(t)) mine.add(t);
      const e = syn.resolve(c, null, true);
      if (e && ext.has(e)) exact.add(e);
    }
    for (const t of mine) refs.push([node.id, t]);
    found.set(node.id, exact);   // 아래로 옮겨 다는 건 정확히 적은 경로만
  }
  const rootIds = new Set(syn.scans.map((s) => s.rootId));
  const extAbs = (id) => id.slice(4).toLowerCase();
  const claimed = new Set();
  const units = nodes.filter((n) => n.type === '하위').sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  for (const u of units) {
    const mine = [...found.get(u.id)].filter((t) => !rootIds.has(t)).sort((a, b) => extAbs(a).length - extAbs(b).length);
    const took = [];
    for (const t of mine) {
      if (claimed.has(t) || took.some((a) => extAbs(t).startsWith(`${extAbs(a)}/`))) continue;   // 이미 옮긴 폴더 안이면 그대로
      claimed.add(t);
      ext.get(t).parent = u.id;
      took.push(t);
    }
  }
  for (const n of ext.values()) if (!has(n.parent)) n.parent = chief;

  const edges = [];
  const seen = new Set();
  const ghosts = new Map();
  const tags = new Map();
  const add = (source, target, kind) => {
    if (source === target || seen.has(`${source}>${target}`) || seen.has(`${target}>${source}`)) return;
    seen.add(`${source}>${target}`);
    edges.push({ source, target, kind });
  };

  // 트리 선 먼저 (같은 두 점 사이의 링크는 트리 선 하나로 친다)
  const all0 = [...nodes, ...ext.values()];
  for (const n of all0) if (n.parent !== ME && has(n.parent)) add(n.parent, n.id, 'tree');

  for (const { node, f } of byName.values()) {
    const d = f.data ?? {};
    // dept·unit 속성은 그 부서·하위 항목 문서로 가는 링크로 친다
    if (d.unit && has(unitId(d.dept, d.unit))) add(node.id, unitId(d.dept, d.unit), 'link');
    else if (d.dept && d.type !== '부서' && has(deptId(d.dept))) add(node.id, deptId(d.dept), 'link');
    const text = `${JSON.stringify(d)}
${f.body}`;
    for (const m of text.matchAll(LINK)) {
      const t = m[1].trim();
      if (has(t)) add(node.id, t, 'link');
      else {
        const gid = `?${t}`;
        if (!ghosts.has(gid)) ghosts.set(gid, { id: gid, type: '유령', title: t, parent: null, dept: null, bytes: 0, created: node.created });
        add(node.id, gid, 'unresolved');
      }
    }
    const tagList = [...(Array.isArray(d.tags) ? d.tags : []), ...[...f.body.matchAll(TAG)].map((m) => m[2])];
    node.tags = [...new Set(tagList.map(String))];
    for (const t of node.tags) {
      const tid = `#${t}`;
      if (!tags.has(tid)) tags.set(tid, { id: tid, type: '태그', title: tid, parent: null, dept: null, bytes: 0, created: node.created });
      add(node.id, tid, 'tag');
    }
  }
  for (const [a, b] of refs) add(a, b, 'link');
  for (const s of syn.scans) for (const [a, b] of s.links) add(a, b, 'link');
  for (const n of ext.values()) n.tags = [];

  // 깊이: 비서실장 0, 부서 1, 하위 항목 2, … (트리 부모를 따라)
  const parentOf = new Map(all0.map((n) => [n.id, n.parent]));
  const depth = new Map();
  const depthOf = (id, guard = 0) => {
    if (depth.has(id)) return depth.get(id);
    const p = parentOf.get(id);
    const v = !p || p === ME || guard > 40 ? 0 : depthOf(p, guard + 1) + 1;
    depth.set(id, v);
    return v;
  };
  for (const n of all0) n.depth = depthOf(n.id) + (chief === ME ? 1 : 0);

  const all = [...all0, ...ghosts.values(), ...tags.values()];
  const degree = new Map();
  for (const e of edges) { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); }
  // 태그·유령은 이어진 점 가운데 가장 얕은 곳보다 한 단계 아래
  const shallow = new Map();
  for (const e of edges) {
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
      if ((a.startsWith('#') || a.startsWith('?')) && depth.has(b)) shallow.set(a, Math.min(shallow.get(a) ?? 99, depth.get(b) + 1));
    }
  }
  for (const n of all) {
    n.degree = degree.get(n.id) ?? 0;
    if (n.depth == null) n.depth = shallow.get(n.id) ?? 4;
  }
  return { nodes: all, edges };
}

// 파일 변경 감시: 짧은 시간에 몰린 변경은 한 번으로 묶는다
export function watchVault(root, onChange, delay = 200) {
  let timer = null;
  const changed = new Set();
  const w = fs.watch(root, { recursive: true }, (_ev, name) => {
    if (!name || name.endsWith('.tmp')) return;
    changed.add(String(name).split('\\').join('/'));
    clearTimeout(timer);
    timer = setTimeout(() => {
      const list = [...changed];
      changed.clear();
      onChange(list);
    }, delay);
  });
  return () => { clearTimeout(timer); w.close(); };
}
