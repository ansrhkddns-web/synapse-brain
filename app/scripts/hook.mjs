// Claude Code 훅 → 두뇌 서버 (자원관리부 PC 작업 추적·제어).
// ~/.claude/settings.json 의 hooks 가 이 스크립트를 부른다 (scripts/hooks.ps1 install).
//   node hook.mjs        stdin = 훅 입력 JSON (session_id, hook_event_name, cwd, tool_name …)
// 서버가 돌려준 out(JSON)이 있으면 그대로 stdout에 — 그것으로 세션을 멈추거나(continue:false) 지시를 이어 준다(Stop의 decision:block).
// 서버가 꺼져 있거나 늦으면 아무것도 하지 않고 끝낸다: 사용자의 세션을 절대 막지 않는다.
import http from 'node:http';

const PORT = Number(process.env.BRAIN_PORT) || 4747;
// 답을 기다려야 하는 사건(멈춤·지시 전달)은 조금 더 기다린다
const WAIT = { PreToolUse: 1500, Stop: 1500, UserPromptSubmit: 1500, SessionStart: 1500 };

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const body = Buffer.concat(chunks);
  let ev = {};
  try { ev = JSON.parse(body.toString('utf8')); } catch { process.exit(0); }
  const timeout = WAIT[ev.hook_event_name] ?? 600;
  const req = http.request({
    host: '127.0.0.1', port: PORT, path: '/api/hooks', method: 'POST', timeout,
    headers: { 'content-type': 'application/json', 'content-length': body.length, 'x-hook-pid': String(process.ppid), ...(process.env.BRAIN_TASK ? { 'x-brain-task': process.env.BRAIN_TASK } : {}) },
  }, (res) => {
    const out = [];
    res.on('data', (c) => out.push(c));
    res.on('end', () => {
      try {
        const r = JSON.parse(Buffer.concat(out).toString('utf8'));
        if (r?.out) process.stdout.write(JSON.stringify(r.out));
      } catch { /* 답이 없으면 그냥 끝 */ }
      process.exit(0);
    });
  });
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.on('error', () => process.exit(0));
  req.end(body);
});
// 무엇이 와도 3초 안에는 끝낸다
setTimeout(() => process.exit(0), 3000).unref();
