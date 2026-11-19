// 마크다운 보기. [[링크]]는 눌러서 그 문서를 연다
import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const wikilink = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => src.indexOf('[['),
  tokenizer(src) {
    const m = /^\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]/.exec(src);
    if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[2] || m[1]).trim() };
    return undefined;
  },
  // 문서 ID·파일 이름만 적힌 링크는 그 문서의 이름을 같이 보인다 (W-261116-001 → "W-261116-001 주간 스킬 수집…")
  renderer: (t) => {
    const title = t.label === t.target ? linkInfo.get(t.target)?.title : null;
    const shown = title && title !== t.target;
    const idLike = /^[WDRK]-\d{6}-\d{3}$/.test(t.target);
    const label = shown ? (idLike ? `<span class="wl-id">${esc(t.target)}</span><span class="wl-t">${esc(title)}</span>` : esc(title)) : esc(t.label);
    return `<a class="wikilink${shown ? (idLike ? ' wl-doc' : ' wl-name') : ''}" href="#" data-name="${esc(t.target)}" title="${esc(linkInfo.get(t.target)?.title ?? t.target)}">${label}</a>`;
  },
};
// #태그: 서버 지도와 같은 규칙(앞이 줄 처음이나 공백). 누르면 그래프를 그 태그로 거른다
const tag = {
  name: 'tag',
  level: 'inline',
  start: (src) => { const m = /(^|\s)#[\p{L}\p{N}_/-]/u.exec(src); return m ? m.index + m[1].length : undefined; },
  tokenizer(src) {
    const m = /^#([\p{L}\p{N}_/-]+)/u.exec(src);
    if (m && !/^\d+$/.test(m[1])) return { type: 'tag', raw: m[0], name: m[1] };
    return undefined;
  },
  renderer: (t) => `<a class="tagchip" href="#" data-tag="${t.name.replace(/"/g, '&quot;')}">#${t.name}</a>`,
};
// 취소선은 ~~두 개~~일 때만 (옵시디언과 같음). "GF01~GF101" 같은 물결 하나는 글자 그대로
const del = {
  del(src) {
    const m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(src);
    return m ? { type: 'del', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) } : undefined;
  },
};
// 링크 대상 이름표: 지도의 점 id → { title } (App이 그래프를 받을 때마다 넣는다)
let linkInfo = new Map();
let linkGen = 0;
export function setLinkInfo(nodes) { linkInfo = new Map((nodes ?? []).map((n) => [n.id, n])); linkGen += 1; }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// `경로` 코드가 지도의 점(참고 문서·폴더)이면 눌러서 연다. refs는 서버가 준 { 코드 글자: 점 id }
let currentRefs = null;
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const renderer = {
  codespan({ text }) {
    const id = currentRefs?.[unescape(text)];
    return id ? `<a class="wikilink ref" href="#" data-name="${id.replace(/"/g, '&quot;')}"><code>${text}</code></a>` : false;
  },
  // ```card 같은 기계용 데이터 블록은 접어 둔다 (결재가 읽는 원본)
  code({ text, lang }) {
    return lang === 'card' ? `<details class="md-data"><summary>원본 데이터 (${esc(lang)})</summary><pre><code>${esc(text)}</code></pre></details>` : false;
  },
};
// 줄바꿈 하나도 줄바꿈으로 (옵시디언 기본과 같음 — "**규칙**: …" 줄들이 한 줄로 붙지 않게)
marked.use({ extensions: [wikilink, tag], tokenizer: del, renderer, gfm: true, breaks: true });
// "- 09:46 …" 처럼 시각으로 시작하는 목록 줄은 시각을 왼쪽 칸에 (진행 로그·기억 기록)
const timeline = (html) => html.replace(/<li>(<p>)?(\d{1,2}:\d{2})(?=\s)/g, (_m, p = '', t) => `<li class="tl">${p}<time>${t}</time>`);

// onPreview: Ctrl(⌘)+마우스로 [[링크]] 위에 올리면 미리보기 (옵시디언 Page preview)
export function Markdown({ text, refs = null, onOpen, onPreview, className = '' }) {
  const html = useMemo(
    () => (currentRefs = refs, DOMPurify.sanitize(timeline(marked.parse(text ?? '')), { ADD_ATTR: ['data-name', 'data-tag', 'target'] })),
    [text, refs, linkGen], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const onClick = (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    if (a.dataset.name) { e.preventDefault(); onOpen?.(a.dataset.name, { newTab: e.ctrlKey || e.metaKey }); return; }
    if (a.dataset.tag) { e.preventDefault(); try { sessionStorage.setItem('brain.graph.q', `tag:${a.dataset.tag}`); } catch { /* 없어도 됨 */ } location.hash = '#/graph'; return; }
    if (/^https?:/.test(a.getAttribute('href') ?? '')) { a.target = '_blank'; a.rel = 'noreferrer'; }
  };
  const onOver = (e) => {
    const a = e.target.closest('a.wikilink');
    if (a && onPreview && (e.ctrlKey || e.metaKey)) onPreview(a.dataset.name, e.clientX, e.clientY);
  };
  const onAux = (e) => {
    const a = e.target.closest('a.wikilink');
    if (a && e.button === 1) { e.preventDefault(); onOpen?.(a.dataset.name, { newTab: true }); }
  };
  return <div className={`md ${className}`} onClick={onClick} onAuxClick={onAux} onMouseOver={onOver} dangerouslySetInnerHTML={{ __html: html }} />;
}
