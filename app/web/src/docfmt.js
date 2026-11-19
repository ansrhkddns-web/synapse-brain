// 문서 본문을 읽기 좋게 다듬기 — 파일은 그대로 두고 화면에서만.
//   · 맨 앞 "# 제목"은 페이지 제목과 겹치니 뺀다
//   · 작업 칸(지시·진행 로그·결과) 안의 머리말은 ### 아래로 (세션이 결과에 ## 를 써도 칸 머리말과 같은 크기가 되지 않게)
//   · 결과 끝의 결과물 목록(절대 경로·보고서 링크)은 따로 떼어 묶어 보여 준다

// 서버 lib/store.mjs demoteHeadings와 같은 규칙: 가장 큰 머리말이 ###가 되게 같은 만큼 내린다 (코드 블록 안은 그대로)
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

export const stripLeadTitle = (body) => String(body ?? '').replace(/^\s*# [^\n]*\n+/, '');

const SECTION = /^## (지시|진행 로그|결과)\s*$/;
const isPath = (s) => /^[A-Za-z]:[\\/]/.test(s) || /^\\\\/.test(s) || /^~?\/[^/\s]/.test(s);
const fileOut = (l) => { const m = /^[-*]\s+`([^`]+)`\s*$/.exec(l); return m && isPath(m[1]) ? { kind: 'path', path: m[1] } : null; };
const linkOut = (l) => { const m = /^[-*]\s+\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]\s*$/.exec(l); return m ? { kind: 'link', id: m[1].trim() } : null; };

// 작업 본문 → { head: 결과 칸까지(결과물 목록 뺌), outputs: [{kind:'path',path}|{kind:'link',id}], tail: 결과 뒤 }
export function taskParts(body) {
  const lines = String(body ?? '').split('\n');
  const starts = lines.map((l, i) => (SECTION.test(l) ? i : -1)).filter((i) => i >= 0);
  // 칸마다 머리말 내리기 (칸이 없는 옛 문서는 그대로)
  const out = [...lines];
  starts.forEach((s, k) => {
    const e = starts[k + 1] ?? lines.length;
    const inner = demoteHeadings(lines.slice(s + 1, e).join('\n')).split('\n');
    out.splice(s + 1, e - s - 1, ...inner);
  });
  const at = out.findIndex((l) => /^## 결과\s*$/.test(l));
  if (at < 0) return { head: out.join('\n'), outputs: [], tail: '' };
  let end = out.findIndex((l, i) => i > at && SECTION.test(l));
  if (end < 0) end = out.length;
  const res = out.slice(at + 1, end);
  const outputs = [];
  let i = res.length - 1;
  for (; i >= 0; i--) {
    const l = res[i].trim();
    if (!l) continue;
    const o = fileOut(l) ?? linkOut(l);
    if (!o) break;
    outputs.unshift(o);
  }
  let cut = i + 1;
  let j = i;
  while (j >= 0 && !res[j].trim()) j--;
  const titled = j >= 0 && /^#{2,6}\s*결과물\s*$/.test(res[j].trim());   // 새 형식의 "### 결과물" 머리말은 묶음 머리가 대신한다
  if (titled) cut = j;
  // 옛 형식에서 링크 하나만 끝에 있으면 본문으로 둔다 (묶음은 경로가 있거나 "결과물" 머리말이 있을 때)
  if (!titled && !outputs.some((o) => o.kind === 'path') && outputs.length < 2) return { head: out.slice(0, end).join('\n'), outputs: [], tail: out.slice(end).join('\n') };
  return { head: [...out.slice(0, at + 1), ...res.slice(0, cut)].join('\n'), outputs, tail: out.slice(end).join('\n') };
}

// 경로 → { name: 파일 이름, dir: 폴더 }
export function splitPath(p) {
  const s = String(p).replace(/[\\/]+$/, '');
  const at = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return at < 0 ? { name: s, dir: '' } : { name: s.slice(at + 1), dir: s.slice(0, at + 1) };
}
