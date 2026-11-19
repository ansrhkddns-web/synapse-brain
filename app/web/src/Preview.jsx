// 문서 미리보기 팝업 — 옵시디언 Page preview처럼 Ctrl(⌘)+마우스로 링크·점 위에 띄운다
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Markdown } from './Markdown.jsx';

const cache = new Map();
const TYPE_KO = { 작업: '작업', 결정: '결정', 보고서: '보고서', 일지: '일지', 지표: '지표', 부서: '부서', 하위: '하위 항목', 총괄: '총괄', 참고: '참고', 폴더: '폴더', 주인말: '주인 말', 검수판정: '검수 판정', 세션지시: '세션 지시', 기억카드: '기억 카드', 배움: '배움' };

export function PreviewPopover({ at, ctx, onClose }) {
  const [doc, setDoc] = useState(() => cache.get(at.name) ?? null);
  const [err, setErr] = useState(null);
  const box = useRef(null);
  const name = at.name.replace(/^부서:/, '');

  useEffect(() => {
    if (cache.has(at.name)) { setDoc(cache.get(at.name)); return; }
    let alive = true;
    api.doc(at.name.startsWith('부서:') ? at.name : at.name)
      .then((d) => { cache.set(at.name, d); if (alive) setDoc(d); })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [at.name]);

  useEffect(() => { cache.clear(); }, [ctx.tick]);

  // 화면 밖으로 나가지 않게 자리 잡기
  const W = 420, H = 360;
  const left = Math.min(window.innerWidth - W - 12, at.x + 16);
  const top = at.y + 18 + H > window.innerHeight ? Math.max(12, at.y - H - 12) : at.y + 18;
  const d = doc?.data ?? {};
  const body = (doc?.body ?? '').slice(0, 1400);

  return (
    <div ref={box} className="preview" style={{ left, top, width: W, maxHeight: H }} onMouseLeave={onClose}>
      <div className="eyebrow"><span className="ebox" />{TYPE_KO[d.type] ?? '문서'} · <b>{name}</b>{d.dept ? <> · {d.dept}</> : null}</div>
      <div className="preview-title">{d.title ?? (d.type === '일지' ? d.date : name)}</div>
      {err ? <div className="faint mono" style={{ fontSize: 11 }}>없는 문서 — 링크만 있어요</div>
        : doc ? <Markdown className="small" text={body + (doc.body.length > 1400 ? '\n\n…' : '')} onOpen={(n) => { onClose(); ctx.open(n); }} />
          : <div className="faint mono" style={{ fontSize: 11 }}>불러오는 중…</div>}
      <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => { onClose(); ctx.open(at.name); }}>열기 →</button>
    </div>
  );
}
