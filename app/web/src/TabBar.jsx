// 문서 탭 — 옵시디언처럼 여러 문서를 열어 두고 오간다. 가운데 버튼 클릭 = 닫기
import { Icon } from './icons.jsx';
import { Kind } from './TaskBits.jsx';
import { OPEN_STATUSES } from './util.js';

export function TabBar({ ctx, tabs, active, onClose }) {
  if (!tabs.length) return null;
  const byId = new Map((ctx.graph?.nodes ?? []).map((n) => [n.id, n]));
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((name) => {
        const n = byId.get(name);
        const done = n && ((n.type === '작업' && !OPEN_STATUSES.includes(n.status)) || (n.type === '결정' && n.status === '결정됨'));
        return (
          <div
            key={name}
            role="tab"
            aria-selected={name === active}
            className={`tab ${name === active ? 'on' : ''}`}
            onClick={() => ctx.go({ view: 'doc', name })}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(name); } }}
            title={n?.title ?? name}
          >
            <Kind type={n?.type ?? '노트'} color={ctx.deptColor[n?.dept]} done={done} />
            <span className="tab-t">{n?.title ?? name}</span>
            <button className="tab-x" onClick={(e) => { e.stopPropagation(); onClose(name); }} aria-label="탭 닫기"><Icon name="x" size={11} /></button>
          </div>
        );
      })}
    </div>
  );
}
