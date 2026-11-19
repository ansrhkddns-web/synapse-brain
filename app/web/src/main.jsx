import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './styles.css';
import './desk.css';

// 화면을 다시 빌드하면 예전 조각 파일 이름이 사라진다 — 열려 있던 탭이 지도·보드를 열다 빈 화면이 되지 않게 한 번 새로 읽는다
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  try { if (sessionStorage.getItem('brain.reloaded') === location.href) return; sessionStorage.setItem('brain.reloaded', location.href); } catch { /* 저장 못 해도 새로 읽는다 */ }
  location.reload();
});

// 화면을 새로 빌드하면 열려 있는 탭도 알아서 새 화면으로 (20초마다 확인, 입력 중이면 기다린다)
const myBuild = [...document.scripts].map((s) => s.src.match(/assets\/index-[\w-]+\.js/)?.[0]).find(Boolean);
if (myBuild) {
  setInterval(async () => {
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text();
      const now = html.match(/assets\/index-[\w-]+\.js/)?.[0];
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && document.activeElement.value;
      if (now && now !== myBuild && !typing) location.reload();
    } catch { /* 서버가 잠깐 꺼져 있으면 다음에 */ }
  }, 20_000);
}

createRoot(document.getElementById('root')).render(<App />);
