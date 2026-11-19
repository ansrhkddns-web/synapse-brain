// 문서 대조 (공정): 문서에 적힌 "끝났다는 표시"(산출물 경로)가 실제로 있는지 보고, 문서의 지금 단계와 어긋나면 알린다.
//   steps.<단계>.check: "{workdir}\{slug}\tts\"  또는 목록. {item} {slug} {workdir} 자리를 바꿔 넣는다.
//   경로 끝이 \ 또는 / 면 "비어 있지 않은 폴더", 어느 조각에든 * 를 쓸 수 있다 (output\영화리뷰\{slug}*\*.mp4)
// 결과: 단계마다 true(있음)·false(없음)·null(확인 표시 없음), 그리고
//   ahead  = 문서의 지금 단계 이후인데 산출물이 이미 있는 가장 먼 단계 (문서가 뒤처짐 — stage를 고쳐야 할 수 있음)
//   missing = 문서상 지난 단계인데 산출물이 없는 단계들 (지웠거나 건너뜀)
import fs from 'node:fs';
import path from 'node:path';

const CACHE_MS = 10_000;
const cache = new Map();   // 공정 id → { at, key, out }

const fillPath = (s, v) => String(s).replace(/\{(item|slug|workdir)\}/g, (_, k) => v[k] ?? '');

// 경로 하나가 있는가 (* 조각·끝 구분자 = 비어 있지 않은 폴더)
export function exists(pattern) {
  const wantDir = /[\\/]$/.test(pattern);
  const parts = pattern.replace(/[\\/]+$/, '').split(/[\\/]+/);
  let bases = [/^[A-Za-z]:$/.test(parts[0]) ? `${parts.shift()}\\` : parts[0] === '' ? (parts.shift(), path.sep) : '.'];
  for (const seg of parts) {
    const next = [];
    for (const b of bases) {
      if (!seg.includes('*')) { const p = path.join(b, seg); if (fs.existsSync(p)) next.push(p); continue; }
      const re = new RegExp(`^${seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
      let names = [];
      try { names = fs.readdirSync(b); } catch { /* 폴더 아님 */ }
      for (const n of names) if (re.test(n)) next.push(path.join(b, n));
    }
    bases = next;
    if (!bases.length) return false;
  }
  if (!wantDir) return true;
  return bases.some((b) => { try { return fs.statSync(b).isDirectory() && fs.readdirSync(b).length > 0; } catch { return false; } });
}

export function verify(p, { now = Date.now(), fresh = false } = {}) {
  const v = { item: p.item, slug: p.slug ?? p.item, workdir: p.workdir ?? '' };
  const key = JSON.stringify([p.slug, p.item, p.workdir, p.stage, p.steps]);
  const c = cache.get(p.id);
  if (!fresh && c && c.key === key && now - c.at < CACHE_MS) return c.out;
  const stages = {};
  for (const s of p.stages) {
    const ch = p.steps?.[s]?.check;
    if (!ch || !p.slug && !p.item) { stages[s] = null; continue; }
    stages[s] = [].concat(ch).every((x) => exists(fillPath(x, v)));
  }
  const at = Math.max(0, p.stages.indexOf(p.stage ?? p.stages[0]));
  let ahead = null;
  p.stages.forEach((s, i) => { if (i >= at && stages[s] === true) ahead = s; });
  const missing = p.stages.filter((s, i) => i < at && stages[s] === false);
  const out = { stages, ahead, missing, checked: Object.values(stages).some((x) => x !== null) };
  cache.set(p.id, { at: now, key, out });
  return out;
}
