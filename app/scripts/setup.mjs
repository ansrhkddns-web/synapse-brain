// 설치판을 이 PC에 맞추기: 문서의 자리표시 {{BRAIN}}(이 프로젝트 폴더)·{{WORK}}(작업 루트)를 실제 경로로 채우고, 빈 보관함 폴더를 만든다.
//   node scripts/setup.mjs [--work <작업 루트>]     작업 루트를 안 주면 프로젝트 폴더의 위 폴더
// 여러 번 돌려도 된다 (자리표시가 없으면 그대로 둔다). 끝나면 보관함 형식 검사를 돌린다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAIN = path.dirname(APP);
const i = process.argv.indexOf('--work');
const WORK = path.resolve(i > 0 ? process.argv[i + 1] : path.dirname(BRAIN));

let n = 0;
function fill(p) {
  if (!fs.existsSync(p)) return;
  if (fs.statSync(p).isDirectory()) { for (const c of fs.readdirSync(p)) fill(path.join(p, c)); return; }
  if (!/\.(md|ya?ml|json)$/i.test(p)) return;
  const s = fs.readFileSync(p, 'utf8');
  const t = s.replaceAll('{{BRAIN}}', BRAIN).replaceAll('{{WORK}}', WORK).replaceAll('{{HOME}}', os.homedir());
  if (t !== s) { fs.writeFileSync(p, t); n++; }
}
for (const d of ['vault', '예시', '부서작업', 'README.md', path.join('app', 'README.md')]) fill(path.join(BRAIN, d));
for (const d of ['작업', '결정', '보고서', '일지', '기억/카드', '지표', '템플릿']) fs.mkdirSync(path.join(BRAIN, 'vault', d), { recursive: true });
fs.mkdirSync(path.join(BRAIN, '부서작업', '스킬관리부'), { recursive: true });   // 스킬관리부 workdir (스킬 수집 결과)
console.log(`프로젝트 폴더: ${BRAIN}\n작업 루트: ${WORK}\n경로를 채운 파일: ${n}개`);

if (!fs.existsSync(path.join(APP, 'node_modules', 'yaml'))) {
  console.log(`\n패키지가 아직 없어 형식 검사를 건너뜀 — npm ci --prefix "${APP}" 뒤에 다시 돌린다`);
  process.exit(1);
}
const r = spawnSync(process.execPath, [path.join(APP, 'scripts', 'check-vault.mjs')], { cwd: APP, encoding: 'utf8' });
process.stdout.write(r.stdout.split('\n').slice(-4).join('\n'));
process.exit(r.status ?? 1);
