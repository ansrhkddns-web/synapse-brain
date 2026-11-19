import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발: npm run dev (5173) → /api는 두뇌 서버(4747)로 넘긴다. 빌드 결과는 두뇌 서버가 직접 제공한다.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4747' },
  },
  // emptyOutDir는 끈다: Node 24 fs.rmSync가 한글 경로에서 죽음 → scripts/clean-dist.mjs가 비운다
  build: { outDir: 'dist', emptyOutDir: false },
});
