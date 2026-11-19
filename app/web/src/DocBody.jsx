// 문서 본문 보기 — 파일은 그대로, 화면에서만 다듬는다 (docfmt.js).
//   작업: 칸 안 머리말 내리기 + 결과 끝 결과물 목록을 "결과물" 묶음으로
//   주인말·검수판정·세션지시: 시각 · 종류 · 이어진 작업 카드로 (MemoryLog)
//   그 밖: 맨 앞 "# 제목"만 뺀다 (페이지 제목과 겹침)
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Markdown } from './Markdown.jsx';
import { MemoryLog } from './MemoryHome.jsx';
import { splitPath, stripLeadTitle, taskParts } from './docfmt.js';

export const MEMORY_DOC = new Set(['주인말', '검수판정', '세션지시']);

export function DocBody({ doc, ctx, onOpen = ctx.open }) {
  const type = doc.data?.type;
  if (MEMORY_DOC.has(type)) return <MemoryDoc doc={doc} ctx={ctx} />;
  if (type === '작업') return <TaskBody doc={doc} ctx={ctx} onOpen={onOpen} />;
  return <Markdown text={stripLeadTitle(doc.body)} refs={doc.refs} onOpen={onOpen} onPreview={ctx.preview} />;
}

function TaskBody({ doc, ctx, onOpen }) {
  const { head, outputs, tail } = useMemo(() => taskParts(doc.body), [doc.body]);
  return (
    <>
      <Markdown text={head} refs={doc.refs} onOpen={onOpen} onPreview={ctx.preview} />
      {outputs.length > 0 && <Outputs items={outputs} refs={doc.refs} ctx={ctx} onOpen={onOpen} />}
      {tail.trim() && <Markdown text={tail} refs={doc.refs} onOpen={onOpen} onPreview={ctx.preview} />}
    </>
  );
}

// 결과물: 파일 이름을 크게, 폴더는 옅게. 지도에 있는 것은 눌러서 열고, 경로는 복사
export function Outputs({ items, refs, ctx, onOpen }) {
  const [copied, setCopied] = useState(null);
  const copy = async (p) => { try { await navigator.clipboard.writeText(p); setCopied(p); setTimeout(() => setCopied((c) => (c === p ? null : c)), 1200); } catch { /* 복사 못 해도 됨 */ } };
  const nodes = useMemo(() => new Map((ctx.graph?.nodes ?? []).map((n) => [n.id, n])), [ctx.graph]);
  return (
    <div className="outs">
      <div className="outs-h"><Icon name="doc" size={13} />결과물 <span className="mono">{items.length}</span></div>
      {items.map((o) => {
        if (o.kind === 'link') {
          const n = nodes.get(o.id);
          return (
            <button key={o.id} className="out-row" onClick={(e) => (e.ctrlKey || e.metaKey ? onOpen(o.id, { newTab: true }) : ctx.pick(o.id, e))} title={o.id}>
              <span className="out-ext">{n?.type ?? '문서'}</span>
              <span className="out-name">{n?.title ?? o.id}</span>
              <span className="out-dir mono">{o.id}</span>
            </button>
          );
        }
        const { name, dir } = splitPath(o.path);
        const id = refs?.[o.path];
        const ext = /\.([A-Za-z0-9]{1,6})$/.exec(name)?.[1]?.toLowerCase() ?? (/[\\/]$/.test(o.path) ? '폴더' : '파일');
        return (
          <div key={o.path} className="out-row">
            <span className="out-ext">{ext}</span>
            {id
              ? <button className="out-name link" onClick={(e) => ctx.pick(id, e)} title="열기">{name}</button>
              : <span className="out-name">{name}</span>}
            <span className="out-dir mono" title={o.path}>{dir}</span>
            <button className="out-copy" onClick={() => copy(o.path)} title="경로 복사">{copied === o.path ? '복사함' : '복사'}</button>
          </div>
        );
      })}
    </div>
  );
}

// 기억 문서(하루치 주인 말·검수 판정·세션 지시): 서버가 줄을 항목으로 나눠 준다 (/api/memory?name=)
function MemoryDoc({ doc, ctx }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.memory({ name: doc.name }).then((d) => alive && setData(d)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [doc.name, doc.body]);
  // 맨 앞 설명 한 줄(무엇을 쌓는 파일인지)은 옅게
  const about = stripLeadTitle(doc.body).split('\n## ')[0].trim();
  if (failed) return <Markdown text={stripLeadTitle(doc.body)} refs={doc.refs} onOpen={ctx.open} onPreview={ctx.preview} />;
  if (!data) return <div className="empty-line">— 불러오는 중</div>;
  const entries = [...(data.days[0]?.entries ?? [])].reverse();   // 하루치 문서는 파일처럼 이른 시각부터
  return (
    <>
      {about && <p className="mem-about">{about}</p>}
      {entries.length ? <MemoryLog entries={entries} refs={data.refs} ctx={ctx} /> : <div className="empty-line">— 기록 없음</div>}
    </>
  );
}
