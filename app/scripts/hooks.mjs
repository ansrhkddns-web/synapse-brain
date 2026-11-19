// 전역 Claude Code 훅 설치·해제 — 이 PC의 모든 Claude Code 세션(데스크톱 앱·터미널)이 사건을 두뇌 서버로 보낸다.
//   node scripts/hooks.mjs install | remove | status
// ~/.claude/settings.json 의 다른 설정은 그대로 두고, hook.mjs를 부르는 항목만 넣고 뺀다. 고치기 전 사본: settings.json.brain-bak
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = process.env.CLAUDE_SETTINGS ?? path.join(os.homedir(), '.claude', 'settings.json');
const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook.mjs');
const COMMAND = `node "${HOOK}"`;
// 답을 돌려줄 수 있는 사건은 기다리고(멈춤·지시), 보기만 하는 사건은 뒤에서(async) 보낸다
const EVENTS = {
  SessionStart: { wait: true }, UserPromptSubmit: { wait: true }, PreToolUse: { wait: true, matcher: '*' }, Stop: { wait: true },
  PostToolUse: { matcher: '*' }, PostToolUseFailure: { matcher: '*' }, Notification: {}, SessionEnd: {},
};
// 설치 폴더 이름이 PC마다 달라도 알아보게: 이 hook.mjs 경로, 또는 예전 폴더 이름
const ours = (h) => typeof h?.command === 'string' && h.command.includes('hook.mjs') && (h.command.includes(HOOK) || h.command.includes('인공두뇌프로젝트'));

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } };
const write = (j) => {
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, `${FILE}.brain-bak`);
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify(j, null, 2)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
};

function strip(j) {
  for (const ev of Object.keys(j.hooks ?? {})) {
    j.hooks[ev] = j.hooks[ev].map((m) => ({ ...m, hooks: (m.hooks ?? []).filter((h) => !ours(h)) })).filter((m) => m.hooks.length);
    if (!j.hooks[ev].length) delete j.hooks[ev];
  }
  if (j.hooks && !Object.keys(j.hooks).length) delete j.hooks;
  return j;
}

const cmd = process.argv[2] ?? 'status';
const j = read();
if (cmd === 'install') {
  strip(j);
  j.hooks ??= {};
  for (const [ev, o] of Object.entries(EVENTS)) {
    const h = { type: 'command', command: COMMAND, timeout: 5, ...(o.wait ? {} : { async: true }) };
    (j.hooks[ev] ??= []).push({ ...(o.matcher ? { matcher: o.matcher } : {}), hooks: [h] });
  }
  write(j);
  console.log(`설치함: ${FILE} — 사건 ${Object.keys(EVENTS).length}종 → ${HOOK}`);
  console.log('이미 열려 있는 세션은 다음 시작부터(또는 /hooks 다시 읽기 후) 적용된다.');
} else if (cmd === 'remove') {
  write(strip(j));
  console.log(`뺌: ${FILE}`);
} else {
  const on = Object.entries(j.hooks ?? {}).filter(([, ms]) => ms.some((m) => (m.hooks ?? []).some(ours))).map(([ev]) => ev);
  console.log(on.length ? `설치됨 (${on.join(', ')})` : '설치 안 됨');
}
