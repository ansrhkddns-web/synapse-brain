// PC 사용량 (자원관리부 / PC사용량): 지도의 계기판 노드와 오른쪽 패널.
// 서버 측정기(/api/usage)는 누가 볼 때만 돈다 — 이 화면들이 떠 있는 동안 4초마다 묻는다.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';

export const USAGE_UNIT = { dept: '자원관리부', name: 'PC사용량' };
const EVERY = 4000;

export function useUsage(on = true) {
  const [u, setU] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let alive = true;
    const pull = () => api.usage().then((x) => { if (alive) setU(x); }).catch(() => {});
    pull();
    const t = setInterval(pull, EVERY);
    return () => { alive = false; clearInterval(t); };
  }, [on]);
  return u;
}

const gb = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)}GB` : `${Math.round(b / 1024 ** 2)}MB`);
const pct = (n) => `${n < 10 && n % 1 ? n.toFixed(1) : Math.round(n)}%`;
const level = (p) => (p >= 85 ? 'hot' : p >= 60 ? 'warm' : '');

function Bar({ label, value, sub }) {
  return (
    <div className={`ug-bar ${level(value)}`}>
      <span className="ug-k">{label}</span>
      <span className="ug-track"><i style={{ width: `${Math.min(100, value)}%` }} /></span>
      <b className="num">{pct(value)}</b>
      {sub && <span className="ug-sub num">{sub}</span>}
    </div>
  );
}

// 한 줄 몫: CPU · RAM · GPU (0이면 빼서 짧게)
export function Share({ x, gpu = true }) {
  const parts = [['CPU', x.cpu], ['RAM', x.memPct], ...(gpu ? [['GPU', x.gpu], ['VRAM', x.vramPct]] : [])].filter(([, v]) => v >= 0.1);
  if (!parts.length) return <span className="ug-share quiet">거의 안 씀</span>;
  return <span className="ug-share">{parts.map(([k, v]) => <span key={k} className={level(v)}><em>{k}</em>{pct(v)}</span>)}</span>;
}

// 지도 노드 안: 전체 막대 3줄 + 지금 도는 작업 몫 + 가장 무거운 프로그램
export function UsageGauge({ u, ctx }) {
  if (!u) return <div className="ug-wait">재는 중…</div>;
  const title = (id) => ctx.state.tasks.find((t) => t.id === id)?.title ?? id;
  return (
    <>
      <div className="ug-head"><span>PC 사용량</span><span className="grow" /><span className="mono">{u.warming ? '재는 중' : '4초마다'}</span></div>
      <Bar label="CPU" value={u.cpu} />
      <Bar label="RAM" value={u.ram.pct} sub={`${gb(u.ram.used)}/${gb(u.ram.total)}`} />
      {u.gpu && <Bar label="GPU" value={u.gpu.util} sub={`VRAM ${pct(u.gpu.memPct)}`} />}
      <div className="ug-sec">작업 세션 {u.tasks.length || ''}</div>
      {u.tasks.length ? u.tasks.slice(0, 3).map((t) => (
        <div key={t.task} className="ug-row live"><i /><span className="ug-name">{title(t.task)}</span><Share x={t} /></div>
      )) : <div className="ug-row quiet">도는 세션 없음</div>}
      <div className="ug-sec">무거운 프로그램</div>
      {u.top.slice(0, 3).map((p) => (
        <div key={p.name} className="ug-row"><span className="ug-name mono">{p.name}{p.count > 1 ? ` ×${p.count}` : ''}</span><Share x={p} /></div>
      ))}
    </>
  );
}

// 오른쪽 패널: 전체 값 + 작업 세션별 몫(자식 프로세스까지) + 서버 + 무거운 프로그램 8개
export function UsagePanel({ ctx }) {
  const u = useUsage(true);
  const task = (id) => ctx.state.tasks.find((t) => t.id === id);
  return (
    <>
      <div className="insp-head">
        <div className="insp-top">
          <span className="insp-eyebrow">자원관리부 / PC사용량</span>
          <span className="grow" />
          <button className="iconbtn" onClick={() => ctx.pick('하위:자원관리부/PC사용량')} title="하위 항목 문서 보기"><Icon name="doc" size={14} /></button>
          <button className="iconbtn" onClick={ctx.closePanel} title="패널 닫기 (Ctrl+.)"><Icon name="x" size={14} /></button>
        </div>
        <div className="insp-title">PC 사용량</div>
        <div className="ug-note">{u ? `${new Date(u.at).toLocaleTimeString('ko-KR', { hour12: false })} 측정 · 4초마다 · 논리 코어 ${u.cores}개` : '재는 중…'}</div>
      </div>
      <div className="insp-body usage-panel">
        {u && (
          <>
            <section className="ug-card">
              <Bar label="CPU" value={u.cpu} />
              <Bar label="RAM" value={u.ram.pct} sub={`${gb(u.ram.used)} / ${gb(u.ram.total)}`} />
              {u.gpu ? (
                <>
                  <Bar label="GPU" value={u.gpu.util} sub={`${u.gpu.temp}°C`} />
                  <Bar label="VRAM" value={u.gpu.memPct} sub={`${gb(u.gpu.memUsed)} / ${gb(u.gpu.memTotal)}`} />
                  <div className="ug-note mono">{u.gpu.name}</div>
                </>
              ) : <div className="ug-note">NVIDIA GPU 값을 읽지 못함</div>}
            </section>

            <h4 className="ug-h">지금 도는 작업 세션 <span className="num">{u.tasks.length}</span></h4>
            {u.tasks.length ? u.tasks.map((t) => {
              const x = task(t.task);
              return (
                <button key={t.task} className="ug-item live" onClick={(e) => ctx.pick(t.task, e)}>
                  <div className="ug-item-top"><i style={{ '--c': ctx.deptColor[x?.dept] }} /><b>{x?.title ?? t.task}</b><span className="grow" /><span className="mono">{t.task}</span></div>
                  <Share x={t} />
                  <div className="ug-procs mono">{x?.dept ? `${x.dept} · ` : ''}프로세스 {t.count}개 — {t.procs.join(', ')}</div>
                </button>
              );
            }) : <div className="ug-empty">지금 도는 세션이 없어요. 세션이 띄운 ffmpeg·python 같은 자식 프로그램도 그 작업 몫으로 셉니다.</div>}

            <h4 className="ug-h">SYNAPSE BRAIN 서버</h4>
            <div className="ug-item">
              <Share x={u.server} />
              <div className="ug-procs mono">프로세스 {u.server.count}개 — {u.server.procs.join(', ')}</div>
            </div>

            <h4 className="ug-h">무거운 프로그램</h4>
            <table className="ug-table">
              <thead><tr><th>프로그램</th><th>CPU</th><th>RAM</th><th>GPU</th><th>VRAM</th></tr></thead>
              <tbody>
                {u.top.map((p) => (
                  <tr key={p.name}>
                    <td className="mono" title={p.name}>{p.name}{p.count > 1 && <span className="ug-cnt"> ×{p.count}</span>}</td>
                    <td className={`num ${level(p.cpu)}`}>{pct(p.cpu)}</td>
                    <td className={`num ${level(p.memPct)}`} title={gb(p.mem)}>{pct(p.memPct)}</td>
                    <td className={`num ${level(p.gpu)}`}>{pct(p.gpu)}</td>
                    <td className={`num ${level(p.vramPct)}`} title={gb(p.vram)}>{pct(p.vramPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ug-note">% 는 PC 전체 대비 — CPU는 모든 코어 합, RAM은 전용 메모리, GPU는 엔진 사용률, VRAM은 전용 그래픽 메모리.</div>
          </>
        )}
      </div>
    </>
  );
}
