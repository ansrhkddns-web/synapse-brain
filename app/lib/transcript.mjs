// 바깥 세션 대화 기록 읽기: ~/.claude/projects/*/<세션 id>.jsonl → 화면용 대화와 증거.
//   read(sessionId, { transcriptPath }) → { file, messages, evidence, folded }
//   messages: [{ uuid, role: 'user'|'assistant', text, tools: [{name, label, arg}], at }] — 두뇌 세션 /messages와 같은 모양
//   evidence: { lastText, artifacts: [{url, path, at}], files: [{path, kind: '쓰기'|'읽기', at}], commands, tools, turns, startedAt, endedAt }
// 큰 기록(스크린샷이 든 수십 MB)은 끝 TAIL만 읽는다(folded = 앞에서 접은 바이트). 파일 크기·수정 시각이 같으면 다시 읽지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolLabel, argOf } from './ko.mjs';

export const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const TAIL = 4 * 1024 * 1024;
const ARTIFACT = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/;
const WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const COMMANDS = new Set(['Bash', 'PowerShell']);
// 시스템이 붙인 <태그>…</태그> 덩어리는 사람 말이 아니다
const human = (s) => String(s ?? '').replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, '').trim();
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '');

// 세션 id로 기록 파일 찾기 (훅이 알려 준 경로가 먼저)
const found = new Map();
export function locate(sessionId, { transcriptPath = null, projectsDir = PROJECTS } = {}) {
  if (transcriptPath && fs.existsSync(transcriptPath)) return transcriptPath;
  const hit = found.get(sessionId);
  if (hit && fs.existsSync(hit)) return hit;
  try {
    for (const d of fs.readdirSync(projectsDir)) {
      const f = path.join(projectsDir, d, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) { found.set(sessionId, f); return f; }
    }
  } catch { /* 폴더 없음 */ }
  return null;
}

export function parse(text) {
  const messages = [];
  const ev = { lastText: null, lastUuid: null, artifacts: [], files: [], commands: 0, failed: 0, tools: 0, turns: 0, startedAt: null, endedAt: null };
  const uses = new Map();   // tool_use id → {name, input}
  const fileAt = new Map();
  let cur = null;           // 지금 쌓는 답 (사람 말이 올 때까지 한 덩어리)
  const flush = () => { if (cur && (cur.text || cur.tools.length)) messages.push(cur); cur = null; };

  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    // 스크린샷 같은 큰 도구 결과 줄은 건너뛴다 (게시 결과 같은 짧은 결과만 증거로 본다)
    if (line.length > 50_000 && line.includes('"tool_result"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.isSidechain || j.isMeta) continue;
    if (j.timestamp) { ev.startedAt ??= j.timestamp; ev.endedAt = j.timestamp; }

    if (j.type === 'user' && !j.isCompactSummary) {
      const c = j.message?.content;
      if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) {
        for (const b of c) {
          if (b.type !== 'tool_result') continue;
          const use = uses.get(b.tool_use_id);
          const out = resultText(b.content);
          // 파일 증거는 성공한 결과가 온 호출만 (실패한 Edit은 쓰기가 아니다)
          if (use?.file && !b.is_error && !/^<tool_use_error>/.test(out.trim())) {
            const old = fileAt.get(use.file.path);
            fileAt.set(use.file.path, { ...use.file, kind: old?.kind === '쓰기' ? '쓰기' : use.file.kind, at: j.timestamp ?? use.file.at });
          }
          if (use?.name === 'Bash' || use?.name === 'PowerShell') { if (b.is_error) ev.failed++; }
          // 게시 결과만 ("Published <파일> at <주소>") — 종류 목록·읽기 결과의 주소는 증거가 아니다
          const url = use?.name === 'Artifact' && /^Published\b/.test(out.trim()) ? out.match(ARTIFACT)?.[0] : null;
          if (url && !ev.artifacts.some((a) => a.url === url && a.path === use.input?.file_path)) {
            ev.artifacts.push({ url, path: use.input?.file_path ?? null, at: j.timestamp ?? null });
          }
        }
        continue;
      }
      const t = human(typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '');
      if (!t || /^This session is being continued/.test(t)) continue;
      flush();
      ev.turns++;
      messages.push({ uuid: j.uuid ?? `u${messages.length}`, role: 'user', text: t, tools: [], at: j.timestamp ?? null });
      continue;
    }
    if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
      cur ??= { uuid: j.uuid ?? `a${messages.length}`, role: 'assistant', text: '', tools: [], at: j.timestamp ?? null };
      for (const b of j.message.content) {
        if (b.type === 'text' && b.text?.trim()) {
          cur.text = cur.text ? `${cur.text}\n\n${b.text.trim()}` : b.text.trim();
          ev.lastText = b.text.trim();
          ev.lastUuid = j.uuid ?? null;   // 판정이 "어느 답을 봤나"를 이 값으로 맞춘다
        } else if (b.type === 'tool_use') {
          ev.tools++;
          const p = b.input?.file_path ?? b.input?.notebook_path;
          const kind = !p ? null : WRITES.has(b.name) ? '쓰기' : b.name === 'Read' ? '읽기' : null;
          // 파일은 결과가 성공으로 왔을 때 증거에 넣는다 (위 tool_result 처리). 같은 파일은 한 번, 쓰기가 읽기를 이긴다
          uses.set(b.id, { name: b.name, input: b.input, file: kind ? { path: p, kind, at: j.timestamp ?? null } : null });
          cur.tools.push({ name: b.name, label: toolLabel(b.name, 1), arg: argOf(b.input) });
          if (COMMANDS.has(b.name)) ev.commands++;
        }
      }
    }
  }
  flush();
  ev.files = [...fileAt.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  ev.artifacts.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { messages, evidence: ev };
}

const cache = new Map();   // file → {size, mtimeMs, out}
// 이미 읽어 둔 결과만 (파일을 읽지 않는다 — 목록 API가 쓴다)
export function peek(sessionId) {
  const f = sessionId ? found.get(sessionId) : null;
  return f ? cache.get(f)?.out ?? null : null;
}
export function read(sessionId, opts = {}) {
  const file = locate(sessionId, opts);
  if (!file) return null;
  let st; try { st = fs.statSync(file); } catch { return null; }
  const c = cache.get(file);
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.out;
  const n = Math.min(st.size, TAIL);
  const fd = fs.openSync(file, 'r');
  let text;
  try {
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, st.size - n);
    text = buf.toString('utf8');
    if (n < st.size) text = text.slice(text.indexOf('\n') + 1);   // 잘린 첫 줄 버림
  } finally { fs.closeSync(fd); }
  const out = { file, ...parse(text), folded: st.size - n };
  cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, out });
  found.set(sessionId, file);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return out;
}
