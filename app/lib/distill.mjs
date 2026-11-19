// 기억 카드 후보 뽑기: 그날의 주인 말·검수 판정·세션 지시(+ 거기 링크된 작업·결정)를 읽기만 하는 세션이 읽고,
// 다음에도 다시 쓸 "판단 기준"만 규칙 한 줄 후보로 돌려준다. 사람이 결재해야 카드가 된다.
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { ASK_MODEL } from './ask.mjs';

const MAX = 5;

const PROMPT = ({ date, files, cards, depts }) => [
  `${date} 기록에서 기억 카드(규칙) 후보를 뽑아라.`,
  '',
  `읽을 파일(보관함 기준): ${files.join(', ')}. 필요하면 거기 링크된 작업·결정 파일([[W-…]], [[D-…]])도 읽는다.`,
  '',
  '기억 카드 = 사람이 다음에 또 똑같이 말하지 않아도 되도록, 그 사람의 판단 기준을 한 줄 규칙으로 적은 것.',
  '- 한 번뿐인 지시("E023 올려줘")는 규칙이 아니다. 되풀이될 판단·취향·금지·순서·품질 기준만 뽑는다.',
  '- 다시 열기 이유, 결정 메모, 이어 시키기에서 고친 점이 좋은 재료다.',
  '- 세션 지시(앱 세션에서 한 말)는 양이 많다. 같은 불만·교정이 되풀이되거나 "~하지 마", "항상 ~"처럼 기준을 말한 곳을 찾는다.',
  '- 규칙은 명령형 한국어 한 줄(80자 안쪽), 누가 읽어도 바로 따를 수 있게. 예: "썸네일 문구는 장면을 먼저 만든 뒤에 붙인다".',
  `- 적용 범위: 특정 부서·하위 항목에만 맞으면 dept·unit을 쓰고, 모두에게 맞으면 null. 부서·하위 이름은 이 중에서만: ${depts}`,
  `- 이미 있는 카드와 같은 뜻이면 뽑지 않는다. 지금 카드:\n${cards.length ? cards.map((c) => `  - ${c}`).join('\n') : '  (없음)'}`,
  `- 많아야 ${MAX}개. 뽑을 게 없으면 빈 배열.`,
  '',
  '답은 아래 형식의 JSON 하나만 (```json 코드 블록 안에):',
  '[{"rule": "…", "dept": "영상편집부" | null, "unit": "몬티" | null, "sources": ["주인말-2026-10-30", "W-261030-005"], "why": "어느 기록에서 왜 뽑았는지 한두 줄"}]',
].join('\n');

export function parseCandidates(text) {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text.match(/\[[\s\S]*\]/)?.[0] ?? '[]';
  let arr;
  try { arr = JSON.parse(block); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c) => c && typeof c.rule === 'string' && c.rule.trim())
    .slice(0, MAX)
    .map((c) => ({
      rule: c.rule.trim(),
      dept: typeof c.dept === 'string' && c.dept.trim() ? c.dept.trim() : null,
      unit: typeof c.unit === 'string' && c.unit.trim() ? c.unit.trim() : null,
      sources: Array.isArray(c.sources) ? c.sources.map(String).slice(0, 8) : [],
      why: typeof c.why === 'string' ? c.why.trim() : '',
    }));
}

// files: 그날 기억 파일(보관함 기준 경로), cards: 지금 쓰는 카드 규칙들, scopes: "부서" 또는 "부서/하위" 목록
export function createDistill({ root, queryFn = sdkQuery }) {
  let busy = false;
  return async function distill({ date, files, cards, scopes }) {
    if (busy) throw Object.assign(new Error('이미 후보를 뽑는 중'), { status: 409 });
    busy = true;
    let text = '';
    try {
      const it = queryFn({
        prompt: PROMPT({ date, files, cards, depts: scopes.join(', ') }),
        options: {
          cwd: root,
          model: ASK_MODEL,
          maxTurns: 14,
          permissionMode: 'default',
          allowedTools: ['Read', 'Grep', 'Glob'],
          disallowedTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'WebSearch', 'WebFetch', 'Task', 'TodoWrite'],
          canUseTool: async () => ({ behavior: 'deny', message: '후보 뽑기는 읽기만 한다' }),
          systemPrompt: { type: 'preset', preset: 'claude_code', append: '# SYNAPSE BRAIN 기억 카드 후보 뽑기\n파일은 읽기만 한다. 답은 요청한 JSON만.' },
          settingSources: [],
          stderr: () => {},
        },
      });
      for await (const m of it) {
        if (m.type === 'assistant' && !m.parent_tool_use_id) {
          const t = m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          if (t) text = t;
        } else if (m.type === 'result' && typeof m.result === 'string' && m.result.trim()) text = m.result.trim();
      }
    } finally {
      busy = false;
    }
    return parseCandidates(text);
  };
}
