import { Icon } from './icons.jsx';

export function StatusBar({ ctx, connected, theme, onTheme }) {
  const { state, graph } = ctx;
  const live = state.tasks.filter((t) => t.runtime.phase === '실행').length;
  const queued = state.tasks.filter((t) => t.runtime.phase === '대기열').length;
  return (
    <footer className="statusbar">
      <span className={connected ? 'ok' : 'bad'}>●</span><span><b>SYNAPSE BRAIN</b></span>
      <span>{state.depts.length} depts</span>
      <span>{graph?.nodes.length ?? 0} docs</span>
      <span>{graph?.edges.length ?? 0} links</span>
      <span>{state.tasks.length} processes</span>
      <span><b>{live}</b> live{queued ? ` · ${queued} queued` : ''}</span>
      <span className="grow" />
      <span className={connected ? 'ok' : 'bad'}>● {connected ? 'stream' : 'offline'}</span>
      <span>127.0.0.1:4747</span>
      <button onClick={onTheme} title="테마 바꾸기">theme <b>{theme === 'dark' ? '그래파이트' : '라이트'}</b> <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={11} /></button>
      <span><kbd>Ctrl K</kbd> 검색</span>
      <span><kbd>Alt 2</kbd> 지도</span>
    </footer>
  );
}
