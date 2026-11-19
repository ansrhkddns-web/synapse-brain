// 두뇌 서버 API (app/README.md의 표와 같다)
async function call(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `${r.status} ${r.statusText}`);
  return json;
}

const enc = encodeURIComponent;

export const api = {
  state: () => call('GET', '/api/state'),
  task: (id) => call('GET', `/api/tasks/${enc(id)}`),
  messages: (id) => call('GET', `/api/tasks/${enc(id)}/messages`),
  createTask: (body) => call('POST', '/api/tasks', body),
  send: (id, text) => call('POST', `/api/tasks/${enc(id)}/messages`, { text }),
  setStatus: (id, status, note = null) => call('POST', `/api/tasks/${enc(id)}/status`, { status, note }),
  rename: (id, title) => call('POST', `/api/tasks/${enc(id)}/title`, { title }),
  runNow: (id) => call('POST', `/api/tasks/${enc(id)}/run`, {}),
  stop: (id) => call('POST', `/api/tasks/${enc(id)}/stop`, {}),
  decision: (id) => call('GET', `/api/decisions/${enc(id)}`),
  answer: (id, choice, note) => call('POST', `/api/decisions/${enc(id)}`, { choice, note }),
  doc: (name) => call('GET', `/api/docs/${enc(name)}`),
  saveDoc: (name, raw) => call('PUT', `/api/docs/${enc(name)}`, { raw }),
  search: (q) => call('GET', `/api/search?q=${enc(q)}`),
  graph: () => call('GET', '/api/graph'),
  createUnit: (body) => call('POST', '/api/units', body),
  ask: (q) => call('POST', '/api/ask', { q }),
  // 기억 기록(주인말·검수판정·세션지시) 항목: { days } 최근 며칠 · { name } 파일 하나
  memory: (q = {}) => call('GET', `/api/memory?${new URLSearchParams(q)}`),
  cards: () => call('GET', '/api/memory/cards'),
  memRank: () => call('GET', '/api/memory/rank'),
  learn: () => call('GET', '/api/learn'),
  learnAdd: (b) => call('POST', '/api/learn', b),
  learnExtract: (date) => call('POST', '/api/learn/extract', date ? { date } : {}),
  learnPropose: () => call('POST', '/api/learn/propose', {}),
  learnState: (id, status) => call('POST', `/api/learn/state/${enc(id)}`, { status }),
  memMark: (id, mark) => call('POST', `/api/memory/rank/${enc(id)}`, { mark }),
  patchCard: (id, patch) => call('POST', `/api/memory/cards/${enc(id)}`, patch),
  propose: (date) => call('POST', '/api/memory/propose', { date }),
  usage: () => call('GET', '/api/usage'),
  activity: () => call('GET', '/api/activity'),
  // 바깥 세션 제어 (훅으로 연결된 세션): { stop: true } · { message }
  controlSession: (id, body) => call('POST', `/api/activity/sessions/${enc(id)}/control`, body),
  // 취소: message(메시지 id)를 주면 그 지시 하나만, 없으면 대기 명령 전부
  cancelSession: (id, message = null) => call('POST', `/api/activity/sessions/${enc(id)}/cancel`, message ? { message } : {}),
  // 데스크: 세션 통합 조회 · 내 차례 · 증거 · 판정 · 칩 글
  sessions: () => call('GET', '/api/sessions'),
  attention: () => call('GET', '/api/attention'),
  evidence: (id) => call('GET', `/api/tasks/${enc(id)}/evidence`),
  review: (id, verdict, answer, note = null) => call('POST', `/api/tasks/${enc(id)}/review`, { verdict, answer, ...(note ? { note } : {}) }),
  chips: () => call('GET', '/api/chips'),
  // 공정 실행기
  processRun: (id) => call('POST', `/api/processes/${enc(id)}/run`, {}),
  processApprove: (id, note) => call('POST', `/api/processes/${enc(id)}/approve`, { note: note || undefined }),
  processRetry: (id, note) => call('POST', `/api/processes/${enc(id)}/retry`, { note: note || undefined }),
  processNext: (id) => call('POST', `/api/processes/${enc(id)}/next`, {}),
  processStop: (id) => call('POST', `/api/processes/${enc(id)}/stop`, {}),
  today: () => call('GET', '/api/today'),
  todayDone: (id, undo = false) => call('POST', '/api/today/done', { id, undo }),
  todaySkip: (id) => call('POST', '/api/today/done', { id, skip: true }),
  todayAsk: (id, text) => call('POST', '/api/today/ask', { id, text }),
  taxcal: () => call('GET', '/api/taxcal'),
  taxcalDone: (company, key, done) => call('POST', '/api/taxcal/done', { company, key, done }),
  unitCommand: (unit, name) => call('POST', '/api/units/command', { unit, name }),
  processStage: (id, stage) => call('POST', `/api/processes/${enc(id)}/stage`, { stage }),
  tokens: () => call('GET', '/api/tokens'),
  notify: () => call('GET', '/api/notify'),
  notifyTest: () => call('POST', '/api/notify/test', {}),
  processItem: (id, item, go, slug) => call('POST', `/api/processes/${enc(id)}/item`, { item, go, slug: slug || undefined }),
  stopProgram: (key) => call('POST', '/api/activity/programs/stop', { key }),
  timeline: (dept, task, limit = null) => call('GET', `/api/timeline?${dept ? `dept=${enc(dept)}&` : ''}${task ? `task=${enc(task)}&` : ''}${limit ? `limit=${limit}` : ''}`),
};

// 서버 이벤트 구독. 연결(EventSource)은 하나를 여럿이 나눠 쓴다 — 끊기면 브라우저가 알아서 다시 붙는다
const EVENTS = ['task', 'text', 'tool', 'decision', 'runtime', 'result', 'vault', 'process', 'session', 'activity'];
const listeners = new Set();
let source = null;
let opened = false;
function connect() {
  source = new EventSource('/api/events');
  for (const name of EVENTS) {
    source.addEventListener(name, (e) => {
      let data = {};
      try { data = JSON.parse(e.data); } catch { /* 깨진 사건은 빈 것으로 */ }
      for (const fn of [...listeners]) fn(name, data);
    });
  }
  source.onopen = () => { opened = true; for (const fn of [...listeners]) fn('open', {}); };
  source.onerror = () => { opened = false; for (const fn of [...listeners]) fn('error', {}); };
}
export function subscribe(onEvent) {
  listeners.add(onEvent);
  if (!source) connect();
  else if (opened) setTimeout(() => listeners.has(onEvent) && onEvent('open', {}), 0);
  return () => {
    listeners.delete(onEvent);
    if (!listeners.size && source) { source.close(); source = null; opened = false; }
  };
}
