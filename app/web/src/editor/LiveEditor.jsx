// 라이브 프리뷰 편집기 (CodeMirror 6) — 옵시디언 편집 화면처럼 쓰면서 바로 보이고, 저절로 저장된다.
//   [[ 를 치면 문서 자동완성 · Ctrl/⌘+클릭 = 새 탭 · Ctrl+마우스 = 미리보기 · 원문 모드 전환
import { useEffect, useRef, useState } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { api } from '../api.js';
import { livePreview } from './livePreview.js';
import { Icon } from '../icons.jsx';

// 글자 모양 (색은 CSS 변수로 — 테마를 따라간다)
const look = HighlightStyle.define([
  { tag: t.strong, fontWeight: '700', color: 'var(--text)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'var(--f-mono)', fontSize: '.88em', background: 'var(--surface-3)', borderRadius: '4px', padding: '1px 4px', color: 'var(--text)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--faint)' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--faint)' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: t.heading, color: 'var(--text)', fontWeight: '750' },
]);

// [[ 자동완성: 보관함 문서 제목으로 찾고 ID를 넣는다
function wikiComplete(getNodes) {
  return (cx) => {
    const m = cx.matchBefore(/\[\[[^\]\n]*$/);
    if (!m) return null;
    const q = m.text.slice(2).toLowerCase();
    const options = getNodes()
      .filter((n) => !['유령', '태그'].includes(n.type))
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
      .slice(0, 40)
      .map((n) => ({ label: n.title, detail: `${n.type} · ${n.id.replace(/^부서:/, '')}`, apply: `${n.id === 'CLAUDE' ? 'CLAUDE' : n.id}]]` }));
    return { from: m.from + 2, options, validFor: /^[^\]\n]*$/ };
  };
}

export function LiveEditor({ doc, ctx }) {
  const host = useRef(null);
  const view = useRef(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const [status, setStatus] = useState('saved'); // saved | dirty | saving | error
  const [err, setErr] = useState(null);
  const [source, setSource] = useState(false);
  const preview = useRef(new Compartment());
  const timer = useRef(null);
  const lastSaved = useRef(doc.raw);

  const save = async () => {
    const v = view.current;
    if (!v) return;
    const text = v.state.doc.toString();
    if (text === lastSaved.current) { setStatus('saved'); return; }
    setStatus('saving');
    try {
      await api.saveDoc(doc.name, text);
      lastSaved.current = text;
      setStatus('saved'); setErr(null);
    } catch (e) { setStatus('error'); setErr(e.message); }
  };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.raw,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(look),
          autocompletion({ override: [wikiComplete(() => ctxRef.current.graph?.nodes ?? [])], icons: false }),
          preview.current.of(livePreview({
            onOpen: (n, o) => ctxRef.current.open(n, o),
            onPreview: (n, x, y) => ctxRef.current.preview(n, x, y),
          })),
          placeholder('쓰기 시작…'),
          keymap.of([
            { key: 'Mod-s', run: () => { clearTimeout(timer.current); save(); return true; } },
            ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab,
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            setStatus('dirty');
            clearTimeout(timer.current);
            timer.current = setTimeout(save, 900);
          }),
        ],
      }),
    });
    view.current = v;
    v.focus();
    return () => { clearTimeout(timer.current); if (v.state.doc.toString() !== lastSaved.current) save(); v.destroy(); view.current = null; };
  }, [doc.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // 다른 곳(세션·다른 탭)이 파일을 바꿨고 여기서 고치는 중이 아니면 새 내용으로
  useEffect(() => {
    const v = view.current;
    if (!v || doc.raw === lastSaved.current) return;
    if (v.state.doc.toString() === lastSaved.current) {
      const sel = v.state.selection.main.head;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc.raw }, selection: { anchor: Math.min(sel, doc.raw.length) } });
      lastSaved.current = doc.raw;
      setStatus('saved');
    }
  }, [doc.raw]);

  // 원문 모드: 라이브 프리뷰를 끄고 기호를 다 보인다 (옵시디언 Source mode)
  useEffect(() => {
    view.current?.dispatch({ effects: preview.current.reconfigure(source ? [] : livePreview({
      onOpen: (n, o) => ctxRef.current.open(n, o),
      onPreview: (n, x, y) => ctxRef.current.preview(n, x, y),
    })) });
  }, [source]);

  const label = { saved: '저장됨', dirty: '고치는 중', saving: '저장 중…', error: '저장 안 됨' }[status];
  return (
    <div className={`live ${source ? 'source' : ''}`}>
      <div className="live-bar">
        <span className={`live-status ${status}`}><i />{label}</span>
        <span className="grow" />
        <button className={`chip ${source ? 'on' : ''}`} onClick={() => setSource((v) => !v)} title="원문 모드: 마크다운 기호를 모두 보기">{source ? '원문 모드' : '라이브 프리뷰'}</button>
        <span className="mono faint" style={{ fontSize: 10.5 }}><kbd>[[</kbd> 링크 · <kbd>Ctrl S</kbd> 저장 · <kbd>Ctrl E</kbd> 읽기</span>
      </div>
      {err && <div className="err" style={{ padding: '8px 2px' }}><Icon name="x" size={11} /> 형식 오류로 저장하지 않았어요 — 고치면 다시 저장돼요{'\n'}{err}</div>}
      <div ref={host} className="live-host" />
    </div>
  );
}
