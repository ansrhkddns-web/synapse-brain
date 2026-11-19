// 결과 탭 (= 증거): 마지막 답 전문 · 게시한 아티팩트(새 창) · 성공한 쓰기 파일(경로 복사) · 보고서 · 명령 수·실패 수 · 판정
//   서버 /api/tasks/:id/evidence. 읽은 범위가 일부(partial)면 "끝 4MB만 읽음"을 붙인다.
//   공정 단계 작업은 판정 대신 공정 제어(승인·다시 돌리기)를 보인다.
import { Markdown } from './Markdown.jsx';
import { ProcessControl } from './Process.jsx';
import { ChipRow, CopyButton, hm, useCardActions } from './SessionCard.jsx';
import { shortTime } from './util.js';

export function Evidence({ ev, s, ctx }) {
  const a = useCardActions(s, ctx, ev?.lastAnswer ?? null);
  if (ev === undefined || ev === null) return <div className="empty-line">— 불러오는 중</div>;
  if (ev.error) return <div className="empty-line">— {ev.error}</div>;
  const answer = ev.result || ev.lastText || '';
  const writes = (ev.files ?? []).filter((f) => f.kind === '쓰기');
  const proc = s?.task?.process ? (ctx.state.processes ?? []).find((p) => p.id === s.task.process) : null;
  const empty = !answer && !ev.artifacts?.length && !writes.length && !ev.reports?.length;
  const range = ev.range?.partial ? ' (읽은 범위 안)' : '';
  return (
    <div className="ev">
      {ev.range?.partial && <div className="ev-partial">끝 4MB만 읽음 — 이전 기록은 접힘{ev.range.folded ? ` (${ev.range.folded.toLocaleString()}줄)` : ''}</div>}
      {empty ? (
        <div className="desk-empty">아직 결과가 없어요. 턴이 끝나면 마지막 답과 증거가 여기에 모입니다.</div>
      ) : (
        <>
          {answer && (
            <section className="ev-sec">
              <h4 className="ev-h">마지막 답</h4>
              <div className="ev-answer"><Markdown className="small" text={answer} onOpen={ctx.open} onPreview={ctx.preview} /></div>
            </section>
          )}
          {ev.artifacts?.length > 0 && (
            <section className="ev-sec">
              <h4 className="ev-h">게시한 아티팩트 <span className="mono">{ev.artifacts.length}</span></h4>
              <ul className="ev-list">
                {ev.artifacts.map((x) => (
                  <li key={x.url}>
                    <a href={x.url} target="_blank" rel="noreferrer noopener">{x.path ? x.path.split(/[\\/]/).pop() : x.url}</a>
                    <span className="ev-meta mono">{x.at ? hm(x.at) : ''}</span>
                    <span className="ev-url mono" title={x.url}>{x.url.replace(/^https?:\/\//, '')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {writes.length > 0 && (
            <section className="ev-sec">
              <h4 className="ev-h">고친 파일 <span className="mono">{writes.length}</span></h4>
              <ul className="ev-list">
                {writes.map((f) => (
                  <li key={`${f.path}:${f.at}`}>
                    <span className="ev-path" title={f.path}>{f.path.split(/[\\/]/).pop()}</span>
                    <span className="ev-url mono" title={f.path}>{f.path}</span>
                    <CopyButton text={f.path} label="경로 복사" />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {ev.reports?.length > 0 && (
            <section className="ev-sec">
              <h4 className="ev-h">보고서 <span className="mono">{ev.reports.length}</span></h4>
              <ul className="ev-list">
                {ev.reports.map((r) => (
                  <li key={r.id}><button className="sc-link" onClick={(e) => ctx.pick(r.id, e)}>{r.title}</button><span className="ev-meta mono">{shortTime(r.created)}</span></li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {(ev.found || ev.commands > 0) && (
        <div className="ev-stats">
          <span>명령 {ev.commands ?? 0}번</span>
          <span className={ev.failed ? 'bad' : ''}>실패 {ev.failed ?? 0}번</span>
          <span>도구 {ev.tools ?? 0}번</span>
          <span>턴 {ev.turns ?? 0}번</span>
          {range && <span className="faint">{range.trim()}</span>}
        </div>
      )}
      {proc ? (
        <section className="ev-sec">
          <h4 className="ev-h">공정 단계 — 판정은 공정 버튼으로</h4>
          <ProcessControl p={proc} ctx={ctx} />
        </section>
      ) : s?.actions?.review ? (
        <section className="ev-sec ev-verdict">
          <h4 className="ev-h">판정</h4>
          <ChipRow s={s} a={a} chips={['확인 완료', '다시…']} />
        </section>
      ) : null}
    </div>
  );
}
