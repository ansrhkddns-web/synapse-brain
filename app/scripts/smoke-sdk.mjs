// SDK 연결 시험: 로그인 상태로 세션이 열리는지, 사용자 정의 도구를 부르는지 확인
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const ping = tool('ping', '연결 확인용. 받은 글을 그대로 돌려준다.', { text: z.string() },
  async ({ text }) => ({ content: [{ type: 'text', text: `pong: ${text}` }] }));

const q = query({
  prompt: 'ping 도구를 "안녕"으로 한 번 부르고, 결과를 한 줄로 알려줘.',
  options: {
    cwd: process.argv[2],
    model: 'claude-opus-5-5',
    effort: 'low',
    permissionMode: 'auto',
    mcpServers: { brain: createSdkMcpServer({ name: 'brain', tools: [ping] }) },
    allowedTools: ['mcp__brain__ping'],
    maxTurns: 4,
  },
});
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') console.log('init', m.session_id, m.apiKeySource, m.permissionMode, m.model);
  else if (m.type === 'assistant') for (const b of m.message.content) console.log('assistant', b.type, b.type === 'text' ? b.text : b.type === 'tool_use' ? b.name : '');
  else if (m.type === 'result') console.log('result', m.subtype, m.total_cost_usd, m.num_turns, m.result);
}
