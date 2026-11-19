// 보관함 형식 검사: node scripts/check-vault.mjs [보관함 경로]
// 오류가 있으면 종료 코드 1. 경고(본문 링크·없는 작업 폴더)는 통과시킨다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVault, checkVault } from '../lib/vault.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, '..', '..', 'vault'));

const vault = loadVault(root);
const { errors, warnings } = checkVault(vault);

for (const w of warnings) console.log(`경고  ${w}`);
for (const e of errors) console.log(`오류  ${e}`);
console.log(`\n${root}\n파일 ${vault.files.length}개 · 오류 ${errors.length} · 경고 ${warnings.length}`);
process.exit(errors.length ? 1 : 0);
