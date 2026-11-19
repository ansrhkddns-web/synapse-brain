// dist 비우기. Node 24의 fs.rmSync({recursive})가 한글 경로에서 프로세스째 죽어서(0xC0000409)
// Vite의 emptyOutDir 대신 파일·폴더를 하나씩 지운다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function clear(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { clear(p); fs.rmdirSync(p); } else fs.unlinkSync(p);
  }
}

if (fs.existsSync(dist)) clear(dist);
