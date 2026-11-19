// 화면 확인용 가짜 보관함 만들기: node scripts/make-demo-vault.mjs <빈 폴더> [작업 수]
// 실제 보관함의 규칙·부서·템플릿을 복사하고 작업·결정·보고서·일지를 지어낸다. 실제 보관함은 건드리지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(process.argv[2] ?? '');
const N = Number(process.argv[3] ?? 60);
if (!process.argv[2]) { console.error('사용법: node scripts/make-demo-vault.mjs <빈 폴더> [작업 수]'); process.exit(1); }
const real = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vault');

const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true }); fs.copyFileSync(path.join(real, rel), path.join(out, rel)); };
for (const rel of ['CLAUDE.md', '지표/KPI.md', '템플릿/작업.md', '템플릿/결정.md', '템플릿/보고서.md', '템플릿/일지.md']) copy(rel);
for (const d of fs.readdirSync(path.join(real, '부서'))) {
  copy(`부서/${d}/규칙.md`);
  const sub = path.join(real, '부서', d, '하위');
  if (fs.existsSync(sub)) for (const u of fs.readdirSync(sub)) copy(`부서/${d}/하위/${u}`);
}
for (const d of ['작업', '결정', '보고서', '일지']) fs.mkdirSync(path.join(out, d), { recursive: true });

const TOPICS = {
  비서실: ['아침 계획 정리', '이번 주 일정 조율', '메일 요약', '유튜브 업로드 일정', '저녁 요약', '회의 메모 정리', '주간 회고'],
  개발부: ['인공두뇌 그래프 성능', '자막 도구 버그 수정', '렌더 스크립트 정리', '업로드 자동화'],
  영상편집부: ['몬티 12편 렌더', '썸네일 3안', '뮤직비디오 컷 편집', '자막 싱크 맞추기', '나레이션 TTS', '게임개발지침서 7편', '영화리뷰 편집', '인트로 모션', 'BGM 믹싱', '컬러 그레이딩'],
  번역부: ['Disk_6 받아 적기', '검토대기 확인', 'Disk_5 번역', 'Disk_4 받아 적기', '제외목록 정리'],
  리서치부: ['아침 AI 트렌드', '영상 업스케일 도구 비교', 'TTS 엔진 비교', '클로드 SDK 업데이트', '썸네일 트렌드 조사', '음성 복제 라이선스', 'GPU 렌더 팜 비교'],
  자원관리부: ['D 드라이브 용량 점검', '모델 파일 대장'],
  스킬관리부: ['새 스킬 조사 10월'],
  비정규직: ['다운로드 폴더 정리'],
};
// 영상편집부 하위 항목에 나눠 담는다
const UNITS = { 영상편집부: ['몬티', '게임개발지침서', '영화리뷰', '뮤직비디오'] };
const STATUS = ['실행중', '검수', '완료', '완료', '결정대기', '대기예약', '검수', '완료'];
const pad = (n, w = 3) => String(n).padStart(w, '0');
const w = (rel, s) => fs.writeFileSync(path.join(out, rel), s);
const now = new Date();
const ymd = `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
const yy = ymd.slice(2).replace(/-/g, '');

const depts = Object.keys(TOPICS);
const ids = [];
let dn = 0, rn = 0;
for (let i = 1; i <= N; i++) {
  const dept = depts[i % depts.length];
  const list = TOPICS[dept];
  const title = `${list[i % list.length]}${i > list.length * depts.length ? ` ${Math.ceil(i / 10)}차` : ''}`;
  const id = `W-${yy}-${pad(i)}`;
  let status = STATUS[(i * 7) % STATUS.length];
  // 같은 부서의 앞선 작업 밑으로 들어가는 하위 작업
  const sameDept = ids.filter((x) => x.dept === dept);
  const parent = i % 4 === 0 && sameDept.length ? sameDept[(i * 3) % sameDept.length].id : null;
  let decision = null;
  if (status === '결정대기') {
    dn++; decision = `D-${yy}-${pad(dn)}`;
    w(`결정/${decision}.md`, `---\ntype: 결정\nid: ${decision}\ntitle: ${title} 방향\ntask: "[[${id}]]"\ndept: ${dept}\nstatus: 대기\nkind: 선택\ncreated: ${ymd}T10:00\noptions:\n  - 빠르게\n  - 꼼꼼하게\nrecommended: 1\nchoice: null\nnote: null\n---\n## 배경\n\n[[${id}]] 진행 방향\n`);
  } else if (i % 5 === 1) {
    dn++;
    const did = `D-${yy}-${pad(dn)}`;
    w(`결정/${did}.md`, `---\ntype: 결정\nid: ${did}\ntitle: ${title} 범위\ntask: "[[${id}]]"\ndept: ${dept}\nstatus: 결정됨\nkind: 선택\ncreated: ${ymd}T09:00\noptions:\n  - 가\n  - 나\nrecommended: 1\nchoice: 1\nnote: null\n---\n## 배경\n`);
  }
  let body = '';
  if (dept === '리서치부' || i % 6 === 0) {
    rn++;
    const rid = `R-${yy}-${pad(rn)}`;
    const ref = ids.length ? ids[(i * 5) % ids.length].id : id;
    w(`보고서/${rid}.md`, `---\ntype: 보고서\nid: ${rid}\ntitle: ${title} 보고서\ndept: ${dept}\ntask: "[[${id}]]"\ncreated: ${ymd}T11:00\ntags: []\n---\n## 결론\n\n1. 참고 [[${ref}]]\n`);
    body = `- [[${rid}]]`;
  }
  const hh = pad(8 + (i % 12), 2), mm = pad((i * 7) % 60, 2);
  const unit = UNITS[dept] ? UNITS[dept][i % UNITS[dept].length] : null;
  w(`작업/${id}.md`, `---\ntype: 작업\nid: ${id}\ntitle: ${title}\ndept: ${dept}\nunit: ${unit ?? 'null'}\nstatus: ${status}\ncreated: ${ymd}T${hh}:${mm}\nupdated: ${ymd}T${hh}:${mm}\nsession: null\nschedule: ${status === '대기예약' ? '"매일 07:30"' : 'null'}\nlast_run: null\nparent: ${parent ? `"[[${parent}]]"` : 'null'}\ndecision: ${decision ? `"[[${decision}]]"` : 'null'}\ntags: []\n---\n## 지시\n\n${title}\n\n## 진행 로그\n\n- ${hh}:${mm} 작업 생성\n\n## 결과\n\n${body}\n`);
  ids.push({ id, dept });
}
for (let d = 0; d < 5; d++) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
  const name = `${day.getFullYear()}-${pad(day.getMonth() + 1, 2)}-${pad(day.getDate(), 2)}`;
  const refs = ids.slice(d * 3, d * 3 + 3).map((x) => `- [[${x.id}]]`).join('\n');
  w(`일지/${name}.md`, `---\ntype: 일지\ndate: ${name}\n---\n## 오늘 한 일\n\n${refs}\n`);
}
console.log(`${out}: 작업 ${N} · 결정 ${dn} · 보고서 ${rn} · 일지 5`);
