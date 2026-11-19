// 한국어 사전: 도구 이름·세션 상태·공정 단계를 사람이 읽는 한국어로 (화면·알림·지도가 모두 이것을 쓴다).
//   toolLabel('Edit')              → '파일 고치는 중'   (tense 1 → '파일 고침')
//   now({name:'Edit', arg:'a.mjs'}) → '파일 고치는 중 · a.mjs'
// 화면에 영어 도구 이름을 "말"로 띄우지 않기 위해 서버에서 한 번만 바꾼다.

export const TOOL = {
  Read: ['파일 읽는 중', '파일 읽음'], Write: ['파일 쓰는 중', '파일 씀'], Edit: ['파일 고치는 중', '파일 고침'],
  MultiEdit: ['파일 고치는 중', '파일 고침'], NotebookEdit: ['노트북 고치는 중', '노트북 고침'],
  Bash: ['명령 실행 중', '명령 실행'], PowerShell: ['명령 실행 중', '명령 실행'],
  Glob: ['파일 찾는 중', '파일 찾음'], Grep: ['내용 찾는 중', '내용 찾음'],
  WebSearch: ['웹 검색 중', '웹 검색'], WebFetch: ['웹 페이지 읽는 중', '웹 페이지 읽음'],
  Agent: ['하위 에이전트 돌리는 중', '하위 에이전트'], Task: ['하위 에이전트 돌리는 중', '하위 에이전트'],
  Skill: ['스킬 쓰는 중', '스킬'], Workflow: ['워크플로 돌리는 중', '워크플로'],
  Artifact: ['아티팩트 게시 중', '아티팩트 게시'], ArtifactComments: ['아티팩트 댓글 보는 중', '아티팩트 댓글'],
  ArtifactData: ['아티팩트 데이터 쓰는 중', '아티팩트 데이터'],
  Monitor: ['기다리는 중', '기다림'], ScheduleWakeup: ['나중에 다시 볼 예약 중', '예약'],
  AskUserQuestion: ['질문하는 중', '질문'], TodoWrite: ['할 일 적는 중', '할 일'],
  TaskCreate: ['할 일 적는 중', '할 일'], TaskUpdate: ['할 일 고치는 중', '할 일'],
  SendUserFile: ['파일 보내는 중', '파일 보냄'], ToolSearch: ['도구 찾는 중', '도구 찾음'],
  TaskStop: ['작업 멈추는 중', '작업 멈춤'], SendMessage: ['다른 세션에 말 보내는 중', '말 보냄'],
  EnterPlanMode: ['계획 세우는 중', '계획'], ExitPlanMode: ['계획 확인받는 중', '계획 확인'],
  mcp__brain__log_progress: ['진행 기록 중', '진행 기록'], mcp__brain__request_decision: ['결정 요청 중', '결정 요청'],
  mcp__brain__submit_result: ['결과 제출 중', '결과 제출'], mcp__brain__create_task: ['다른 부서에 맡기는 중', '위임'],
  mcp__brain__write_report: ['보고서 쓰는 중', '보고서'], mcp__brain__rename_task: ['이름 바꾸는 중', '이름 바꿈'],
  mcp__brain__save_unit: ['하위 항목 저장 중', '하위 항목 저장'], mcp__brain__save_process: ['공정 저장 중', '공정 저장'],
};

// mcp__<서버>__<도구> — 서버 이름으로 묶는다
const SERVER = [
  [/^(Claude_Browser|claude-in-chrome|Claude_Preview)$/, ['브라우저 조작 중', '브라우저 조작']],
  [/^terminal$/, ['터미널 쓰는 중', '터미널']],
  [/^ccd_turn$/, ['진행 목록 고치는 중', '진행 목록']],
  [/^ccd_/, ['앱 조작 중', '앱 조작']],
  [/^scheduled-tasks$/, ['예약 작업 고치는 중', '예약 작업']],
  [/^visualize$/, ['그림 그리는 중', '그림']],
  [/^177f2130/, ['아사나 쓰는 중', '아사나']],
  [/^e46c0230/, ['슬랙 쓰는 중', '슬랙']],
  [/^20bfb887|google-drive/, ['구글 드라이브 쓰는 중', '구글 드라이브']],
  [/^1a59c906/, ['Claude 문서 쓰는 중', 'Claude 문서']],
  [/gmail/, ['메일 보는 중', '메일']],
  [/google-calendar/, ['캘린더 보는 중', '캘린더']],
  [/pdf/, ['PDF 보는 중', 'PDF']],
];

export function toolLabel(name, tense = 0) {
  const n = String(name ?? '');
  if (TOOL[n]) return TOOL[n][tense];
  const m = n.match(/^mcp__(.+?)__(.+)$/);
  if (m) {
    const hit = SERVER.find(([re]) => re.test(m[1]));
    if (hit) return hit[1][tense];
    return tense ? '외부 도구' : '외부 도구 쓰는 중';
  }
  // 모르는 도구: 영어 원이름은 화면 말로 쓰지 않는다 (원이름은 name으로 따로 남는다)
  return n ? (tense ? '도구 실행' : '도구 실행 중') : '';
}

// 도구 인자 한 줄 요약 (파일 이름 · 설명 · 명령 앞부분 · 주소의 호스트)
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export function argOf(input = {}) {
  if (!input || typeof input !== 'object') return '';
  const file = input.file_path ?? input.notebook_path ?? input.path;
  if (file) return String(file).split(/[\\/]/).filter(Boolean).pop() ?? '';
  if (input.description) return clip(input.description, 60);
  if (input.command) return clip(input.command, 50);
  if (input.url) { try { return new URL(input.url).host; } catch { return clip(input.url, 40); } }
  if (input.pattern) return clip(input.pattern, 40);
  if (input.query) return clip(input.query, 40);
  if (input.skill) return String(input.skill);
  if (input.recap) return clip(input.recap, 60);
  return '';
}

// 세션 상태 → 화면 말
export const STATE = { 작업중: '작업 중', 입력대기: '입력 대기', 쉬는중: '답 왔음', 응답없음: '응답 없음', 끝남: '끝남', 대기열: '대기열', 여는중: '세션 여는 중', 결정대기: '결정 기다림' };
export const PHASE = { 실행: '실행 중', 대기열: '대기열', 승인대기: '승인 기다림', 실패: '실패', 끝: '끝' };

// 지금 하는 일 한 문장. tool = {name, arg} (arg는 이미 요약된 글) 또는 null
export function now(tool, state = '작업중') {
  if (state === '입력대기') return '입력 기다리는 중';
  if (state === '쉬는중' || state === '끝남') return STATE[state];
  if (!tool?.name) return state === '여는중' ? '세션 여는 중' : '답 쓰는 중';
  const label = toolLabel(tool.name);
  return tool.arg ? `${label} · ${tool.arg}` : label;
}
