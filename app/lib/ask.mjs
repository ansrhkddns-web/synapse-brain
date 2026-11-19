// 기억에 질문하기: 보관함과 부서 작업 폴더(참고 문서)를 읽기만 하는 세션 하나를 띄워 답을 받는다.
// 쓰기·명령·웹은 막고(Read·Grep·Glob만), 답에 근거 문서를 [[ID]] 또는 `절대 경로`로 달게 한다.
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

export const ASK_MODEL = 'claude-sonnet-5-5';   // 찾아 읽고 요약하는 일이라 빠른 모델
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
const MAX_TURNS = 16;

const SYSTEM = (root, roots) => [
  '# SYNAPSE BRAIN 기억 찾기',
  `너는 SYNAPSE BRAIN의 기억(보관함 ${root}${roots.length ? ` + 참고 폴더 ${roots.join(', ')}` : ''})을 찾아 질문에 답한다.`,
  '- 파일은 읽기만 한다(Read·Grep·Glob). 아무것도 고치거나 만들지 않는다.',
  '- 먼저 Grep·Glob으로 관련 문서를 찾고, 읽은 내용만으로 답한다. 기록에 없으면 "기록에 없음"이라고 말한다.',
  '- 한국어로, 짧고 분명하게(핵심 3~8줄). 표나 목록이 낫다면 써도 된다.',
  '- 근거를 꼭 단다: 보관함 문서는 [[파일이름]](확장자 없이, 예: [[W-261030-001]], [[비서실장]]), 보관함 밖 참고 문서는 `절대 경로`로.',
  '- 답 맨 끝에 "근거:" 줄을 두고 쓴 문서를 다시 나열한다.',
].join('\n');

// roots: () => 참고 폴더 절대 경로 목록, resolve: (경로 글자) => 지도 점 id | null, find: ([[이름]]) => 지도 점 id | null
export function createAsk({ root, roots = () => [], resolve = () => null, find = () => null, queryFn = sdkQuery }) {
  let busy = false;
  return async function ask(question) {
    const q = String(question ?? '').trim();
    if (!q) throw Object.assign(new Error('질문이 비었음'), { status: 400 });
    if (busy) throw Object.assign(new Error('다른 질문을 찾는 중 — 끝나면 다시'), { status: 409 });
    busy = true;
    const started = Date.now();
    const dirs = roots();
    let answer = '';
    let turns = 0;
    let cost = 0;
    try {
      const it = queryFn({
        prompt: q,
        options: {
          cwd: root,
          additionalDirectories: dirs,
          model: ASK_MODEL,
          maxTurns: MAX_TURNS,
          permissionMode: 'default',
          allowedTools: READ_TOOLS,
          disallowedTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'WebSearch', 'WebFetch', 'Task', 'TodoWrite'],
          canUseTool: async () => ({ behavior: 'deny', message: '기억 찾기는 읽기만 한다' }),
          systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM(root, dirs) },
          settingSources: [],
          stderr: () => {},
        },
      });
      for await (const m of it) {
        if (m.type === 'assistant' && !m.parent_tool_use_id) {
          const t = m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          if (t) answer = t;
        } else if (m.type === 'result') {
          if (typeof m.result === 'string' && m.result.trim()) answer = m.result.trim();
          turns = m.num_turns ?? 0;
          cost = m.total_cost_usd ?? 0;
        }
      }
    } finally {
      busy = false;
    }
    // 근거: [[링크]]와 `경로` 가운데 지도에 있는 점. [[몬티]]처럼 줄여 쓴 링크는 점 ID로 바꿔 눌러 열 수 있게
    const sources = new Set();
    const refs = {};
    answer = answer.replace(/\[\[([^\]|#]+)(\|[^\]]*)?\]\]/g, (all, name, label) => {
      const id = find(name.trim());
      if (!id) return all;
      sources.add(id);
      return id === name.trim() ? all : `[[${id}|${label ? label.slice(1) : name.trim()}]]`;
    });
    for (const m of answer.matchAll(/`([^`\n]{3,240})`/g)) { const id = resolve(m[1]); if (id) { sources.add(id); refs[m[1]] = id; } }
    return { question: q, answer: answer || '답을 받지 못했다', refs, sources: [...sources], ms: Date.now() - started, turns, cost };
  };
}
