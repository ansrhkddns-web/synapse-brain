// 라이브 프리뷰 — 옵시디언처럼 커서가 없는 줄은 마크다운 기호를 숨기고 결과 모양으로 보여 준다.
//   제목(#) · 굵게/기울임/취소선/코드 기호 · 링크 [글](주소) · [[위키링크]] · 목록 점 · 할 일 [ ] · 인용 > · 가로줄
//   맨 위 frontmatter(---)는 "속성" 블록으로 흐리게 보여 준다.
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';

const WIKI = /\[\[([^\]|#\n]+)(?:[|#]([^\]\n]*))?\]\]/g;

class WikiWidget extends WidgetType {
  constructor(target, label) { super(); this.target = target; this.label = label; }
  eq(o) { return o.target === this.target && o.label === this.label; }
  toDOM() {
    const a = document.createElement('span');
    a.className = 'cm-wikilink';
    a.textContent = this.label;
    a.dataset.name = this.target;
    return a;
  }
  ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-bullet'; s.textContent = '•'; return s; }
}

class CheckWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(o) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM() {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.className = 'cm-task';
    c.checked = this.checked;
    c.dataset.pos = String(this.pos);
    return c;
  }
  ignoreEvent() { return false; }
}

class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const d = document.createElement('span'); d.className = 'cm-hr'; return d; }
}

const hide = Decoration.replace({});

// frontmatter: 문서 맨 앞 --- … --- 범위
function frontmatterRange(doc) {
  if (doc.lines < 2 || doc.line(1).text !== '---') return null;
  for (let i = 2; i <= Math.min(doc.lines, 200); i++) {
    if (doc.line(i).text === '---') return { from: 0, to: doc.line(i).to, endLine: i };
  }
  return null;
}

function build(view) {
  const { state } = view;
  const doc = state.doc;
  const active = new Set();
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number, b = doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) active.add(i);
  }
  const fm = frontmatterRange(doc);
  const items = []; // [from, to, deco]  — 나중에 정렬해서 넣는다
  const lineCls = new Map(); // 줄 시작 → class

  if (fm) {
    for (let i = 1; i <= fm.endLine; i++) {
      const l = doc.line(i);
      lineCls.set(l.from, i === 1 ? 'cm-fm cm-fm-top' : i === fm.endLine ? 'cm-fm cm-fm-bottom' : 'cm-fm');
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (node) => {
        // frontmatter 안은 마크다운으로 읽지 않는다 (--- 때문에 제목으로 잘못 읽히는 것 방지)
        if (fm && node.name !== 'Document' && node.from < fm.to) return false;
        const name = node.name;
        const line = doc.lineAt(node.from);
        const on = active.has(line.number);
        const h = /^ATXHeading(\d)$/.exec(name);
        if (h) { lineCls.set(line.from, `cm-heading-line cm-h${h[1]}`); return undefined; }
        if (name === 'Blockquote') {
          for (let p = node.from; p <= node.to;) { const l = doc.lineAt(p); lineCls.set(l.from, 'cm-quote-line'); p = l.to + 1; }
          return undefined;
        }
        if (on) return undefined;
        if (name === 'HeaderMark') {
          const end = Math.min(line.to, node.to + 1);
          items.push([node.from, end, hide]);
        } else if (['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'QuoteMark'].includes(name)) {
          let end = node.to;
          if (name === 'QuoteMark' && doc.sliceString(end, end + 1) === ' ') end += 1;
          items.push([node.from, end, hide]);
        } else if (name === 'ListMark') {
          const mark = doc.sliceString(node.from, node.to);
          if (mark === '-' || mark === '*' || mark === '+') items.push([node.from, node.to, Decoration.replace({ widget: new BulletWidget() })]);
        } else if (name === 'TaskMarker') {
          const checked = /x/i.test(doc.sliceString(node.from, node.to));
          items.push([node.from, node.to, Decoration.replace({ widget: new CheckWidget(checked, node.from) })]);
        } else if (name === 'HorizontalRule') {
          items.push([node.from, node.to, Decoration.replace({ widget: new HrWidget() })]);
        } else if (name === 'Link') {
          // [글](주소): 글만 남기고 기호·주소는 숨긴다
          const text = doc.sliceString(node.from, node.to);
          const m = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(text);
          if (m) {
            items.push([node.from, node.from + 1, hide]);
            items.push([node.from + 1, node.from + 1 + m[1].length, Decoration.mark({ class: 'cm-mdlink', attributes: { 'data-href': m[2] } })]);
            items.push([node.from + 1 + m[1].length, node.to, hide]);
          }
          return false;
        }
        return undefined;
      },
    });

    // [[위키링크]]: 커서 줄에선 글자를 보이며 색만, 다른 줄에선 이름표 칩으로
    const text = doc.sliceString(from, to);
    for (const m of text.matchAll(WIKI)) {
      const a = from + m.index, b = a + m[0].length;
      if (fm && a < fm.to) continue;
      const on = active.has(doc.lineAt(a).number);
      const target = m[1].trim(), label = (m[2] || m[1]).trim();
      items.push([a, b, on ? Decoration.mark({ class: 'cm-wikilink-src' }) : Decoration.replace({ widget: new WikiWidget(target, label) })]);
    }
  }

  // 겹치지 않게 정렬해서 넣는다 (CodeMirror는 순서대로 받아야 한다)
  const b = new RangeSetBuilder();
  const all = [
    ...[...lineCls].map(([pos, cls]) => [pos, pos, Decoration.line({ class: cls }), -1]),
    ...items.map((x) => [...x, 0]),
  ].sort((x, y) => x[0] - y[0] || x[3] - y[3] || x[1] - y[1]);
  let last = -1;
  for (const [f, t, d, kind] of all) {
    if (kind === 0 && f < last) continue; // 이미 숨긴 범위와 겹치면 건너뛴다
    b.add(f, t, d);
    if (kind === 0) last = Math.max(last, t);
  }
  return b.finish();
}

export function livePreview({ onOpen, onPreview } = {}) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = build(view); }
    update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view); }
  }, { decorations: (v) => v.decorations });

  const events = EditorView.domEventHandlers({
    mousedown(e, view) {
      const w = e.target.closest?.('.cm-wikilink, .cm-wikilink-src, .cm-mdlink');
      if (w && (w.classList.contains('cm-wikilink') || e.ctrlKey || e.metaKey)) {
        let name = w.dataset.name;
        if (!name && w.classList.contains('cm-wikilink-src')) name = w.textContent.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0].trim();
        if (w.classList.contains('cm-mdlink')) { window.open(w.dataset.href, '_blank', 'noreferrer'); e.preventDefault(); return true; }
        if (name) { onOpen?.(name, { newTab: e.ctrlKey || e.metaKey || e.button === 1 }); e.preventDefault(); return true; }
      }
      const box = e.target.closest?.('.cm-task');
      if (box) {
        const pos = Number(box.dataset.pos);
        const cur = view.state.doc.sliceString(pos, pos + 3);
        view.dispatch({ changes: { from: pos, to: pos + 3, insert: /x/i.test(cur) ? '[ ]' : '[x]' } });
        e.preventDefault();
        return true;
      }
      return false;
    },
    mouseover(e) {
      const w = e.target.closest?.('.cm-wikilink');
      if (w && (e.ctrlKey || e.metaKey)) onPreview?.(w.dataset.name, e.clientX, e.clientY);
      return false;
    },
  });
  return [plugin, events];
}
