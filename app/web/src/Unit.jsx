// 하위 항목 패널: 문서의 commands를 버튼으로 (현황 보기·켜기·끄기 같은 것). 출력은 아래 상자에.
//   commands: { 이름: "PowerShell 명령" } 또는 { 이름: { run: "…", confirm: true } } — confirm이면 누를 때 한 번 묻는다
import { useState } from 'react';
import { api } from './api.js';

export function UnitCommands({ u }) {
  const [busy, setBusy] = useState(null);
  const [res, setRes] = useState(null);
  const list = Object.entries(u?.commands ?? {});
  if (!list.length) return null;
  const go = (name, c) => {
    if (typeof c === 'object' && c.confirm && !window.confirm(`"${name}"을(를) 실행할까요?\n${c.run}`)) return;
    setBusy(name); setRes(null);
    api.unitCommand(u.id, name).then((r) => setRes(r)).catch((e) => setRes({ name, code: -1, out: e.message })).finally(() => setBusy(null));
  };
  return (
    <section className="uc">
      <div className="uc-top"><span className="mono">명령</span>{u.workdir && <span className="mono uc-dir" title={u.workdir}>{u.workdir}</span>}</div>
      <div className="uc-btns">
        {list.map(([name, c]) => (
          <button key={name} className={`btn sm ${typeof c === 'object' && c.confirm ? 'danger' : ''}`} disabled={!!busy} onClick={() => go(name, c)} title={typeof c === 'string' ? c : c.run}>
            {busy === name ? `${name}…` : name}
          </button>
        ))}
      </div>
      {res && (
        <div className={`uc-out ${res.code === 0 ? '' : 'bad'}`}>
          <div className="mono">{res.name} · 종료 {res.code}</div>
          <pre>{res.out || '(출력 없음)'}</pre>
        </div>
      )}
    </section>
  );
}
