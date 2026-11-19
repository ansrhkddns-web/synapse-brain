// 세션 관리자: 작업 하나 = Claude Agent SDK 세션 하나.
// 첫 실행은 지시문으로 시작하고, 이후(사용자 메시지·결정 답)는 같은 세션을 resume 한다.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { query as sdkQuery, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { linkTarget } from './vault.mjs';
import { shortTitle, resultText } from './store.mjs';
import { toolLabel, argOf, now as koNow } from './ko.mjs';
import { addLesson, KINDS as LEARN_KINDS } from './learn.mjs';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const BRAIN_TOOLS = ['log_progress', 'request_decision', 'submit_result', 'create_task', 'write_report', 'rename_task', 'save_unit', 'save_process', 'note_learning'];
// 하위 항목·공정을 아무 부서에나 만들고 고칠 수 있는 부서 (비서실장). 다른 부서는 자기 부서 것만
const MANAGER_DEPT = '비서실';
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

const text = (t) => ({ content: [{ type: 'text', text: t }] });

export function createRunner({
  store,
  emit = () => {},
  queryFn = sdkQuery,
  maxRunning = 3,
  permissionMode = 'auto',
  effort = 'high',
} = {}) {
  const live = new Map();      // 작업 ID → { abort, phase: '실행' | '대기열' }
  const inbox = new Map();     // 작업 ID → 실행 중에 들어온 메시지들
  const queue = [];            // 자리가 없어 기다리는 { id, prompt }
  const waiters = new Map();   // 권한 결정 ID → resolve(choice)
  const lastText = new Map();
  const lastRun = new Map();  // 작업 ID → 마지막 실행 요약  // 작업 ID → 마지막 응답 한 줄

  const runningCount = () => [...live.values()].filter((x) => x.phase === '실행').length;
  const vaultDirs = ['작업', '결정', '기억'].map((d) => path.join(store.root, d).toLowerCase());

  function protectVault(input) {
    const p = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
    if (!p) return {};
    const full = path.resolve(String(p)).toLowerCase();
    if (!vaultDirs.some((d) => full.startsWith(d + path.sep))) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '작업·결정 파일은 직접 고치지 않는다. mcp__brain__ 도구를 쓴다.',
      },
    };
  }

  function brainServer(id) {
    const tools = [
      tool('log_progress', '작업의 진행 로그에 한 줄을 남긴다. 의미 있는 단계마다 부른다.',
        { text: z.string().describe('한 줄 요약') },
        async ({ text: t }) => { await store.appendLog(id, t); emit('task', { id }); return text('기록함'); }),

      tool('request_decision',
        '사람이 골라야 진행할 수 있을 때 선택지를 올린다. 부른 뒤에는 바로 턴을 끝내고 기다린다. 사람이 고르면 이 세션으로 답이 온다.',
        {
          title: z.string().describe('무엇을 고르는지 한 줄'),
          options: z.array(z.string()).min(2).max(4).describe('짧은 선택지 2~4개'),
          recommended: z.number().int().optional().describe('추천 번호(1부터)'),
          background: z.string().describe('왜 결정이 필요한지, 선택지별 근거'),
        },
        async (a) => {
          const did = await store.createDecision({ task: id, ...a });
          emit('decision', { id: did, task: id });
          return text(`결정 ${did}를 올렸다. 이제 턴을 끝내고 답을 기다린다.`);
        }),

      tool('note_learning',
        '일하다 새로 알게 된 것을 "배움"으로 한 줄 남긴다 — 다음에 같은 일을 할 때 그대로 쓸 방법·주의점(오류와 해결)·사람 선호·도구 사용법. 쌓이면 스킬관리부가 스킬로 만든다. 뻔한 상식·한 번뿐인 사실은 남기지 않는다.',
        {
          kind: z.enum(LEARN_KINDS).describe('방법(절차·요령) · 주의(함정과 해결) · 선호(사람이 원하는 기준) · 도구(명령·경로 사용법)'),
          text: z.string().describe('한 줄(120자 안쪽), 바로 따라 할 수 있게. 경로·명령은 그대로'),
          skill: z.string().optional().describe('들어가야 할 기존 스킬 이름(알면)'),
        },
        async ({ kind, text: t, skill }) => {
          const { data } = store.readTask(id);
          try {
            const lid = addLesson(store.root, { kind, text: t, skill, by: '세션', dept: data.dept, unit: data.unit, task: id });
            await store.appendLog(id, `배움 남김 ${lid}: ${String(t).slice(0, 60)}`);
            emit('task', { id });
            return text(`배움 ${lid}로 남겼다.`);
          } catch (e) { return text(`못 남김: ${e.message}`); }
        }),

      tool('submit_result', '일을 끝냈을 때 결과를 적고 검수로 넘긴다. 끝낼 때 꼭 한 번 부른다.',
        {
          summary: z.string().describe('무엇을 했는지와 확인할 점. 결과 칸 안이라 머리말은 ### 이하만 (## 를 쓰면 한 단계씩 내려 적힌다). 결과물 경로는 summary가 아니라 paths에'),
          paths: z.array(z.string()).optional().describe('결과물 절대 경로 — 결과 끝 "### 결과물"에 묶여 적힌다'),
          reports: z.array(z.string()).optional().describe('write_report로 만든 보고서 ID'),
        },
        async ({ summary, paths = [], reports = [] }) => {
          await store.setResult(id, resultText(summary, paths, reports));
          await store.appendLog(id, '결과 제출 → 검수');
          emit('task', { id });
          return text('검수로 넘겼다.');
        }),

      tool('create_task', '다른 부서에 일을 맡긴다. 새 작업이 만들어지고 바로 시작된다.',
        {
          dept: z.string().describe('부서 이름'),
          title: z.string().describe('한 줄 제목'),
          instruction: z.string().describe('그 부서에 줄 지시 전문'),
        },
        async ({ dept, title, instruction }) => {
          const nid = await store.createTask({ dept, title, instruction, parent: id });
          await store.appendLog(id, `하위 작업 [[${nid}]] → ${dept}`);
          emit('task', { id: nid });
          start(nid);
          return text(`${nid}를 ${dept}에 맡겼다.`);
        }),

      tool('rename_task', '지금 작업의 이름(title)을 바꾼다. 사용자가 이름을 바꿔 달라고 했을 때, 그리고 지금 이름이 지시 첫머리를 자른 임시 이름일 때(시작하며 한 번) 쓴다. 다른 작업 이름은 못 바꾼다.',
        {
          title: z.string().describe('새 이름 (한 줄, 60자까지)'),
          why: z.string().optional().describe('바꾸는 까닭 (예: 2026-11-01 주인말 요청)'),
        },
        async ({ title, why }) => {
          try {
            const r = await store.renameTask(id, title, '세션이');
            if (!r.changed) return text(`이미 "${r.title}"이다.`);
            if (why?.trim()) await store.appendLog(id, `이름 변경 까닭: ${why.trim()}`);
            emit('task', { id });
            return text(`이름을 "${r.before}" → "${r.title}"로 바꿨다.`);
          } catch (e) { return text(`못 바꿈: ${e.message}`); }
        }),

      tool('write_report', '조사 결과를 보고서 파일로 남긴다. 만든 ID를 submit_result의 reports에 넣는다.',
        {
          title: z.string(),
          conclusions: z.array(z.string()).describe('결론 3줄'),
          body: z.string().describe('본문 마크다운'),
          sources: z.array(z.string()).optional().describe('출처 URL'),
        },
        async (a) => {
          const { data } = store.readTask(id);
          const rid = await store.createReport({ dept: data.dept, task: id, ...a });
          return text(`보고서 ${rid}를 만들었다.`);
        }),

      // 하위 항목·공정 관리 — 형식 검사에 걸리면 저장하지 않고 오류를 돌려준다
      tool('save_unit',
        '부서의 하위 항목(팀·시리즈·채널·작업 묶음)을 만들거나 고친다. 같은 이름이 있으면 준 칸만 바꾼다(null이면 그 칸을 지움). 비서실은 모든 부서, 다른 부서는 자기 부서만.',
        {
          dept: z.string().describe('부서 이름'),
          name: z.string().describe('하위 항목 이름 (파일 이름이 된다)'),
          summary: z.string().nullable().optional().describe('한 줄 설명'),
          workdir: z.string().nullable().optional().describe('작업 폴더 절대 경로 — 다른 하위 항목과 겹치지 않게'),
          match: z.array(z.string()).nullable().optional().describe('이 자리 일로 볼 경로 조각 목록 (PC 작업 추적)'),
          commands: z.record(z.string(), z.string()).nullable().optional().describe('화면 버튼으로 돌릴 명령: 이름 → PowerShell 명령 (예: {"현황": "& \"D:\\…\\run.ps1\" status"})'),
          order: z.number().int().nullable().optional(),
          body: z.string().optional().describe('본문 마크다운 전체 (하는 일·명령·지킬 것). 주면 본문을 바꾼다'),
        },
        async (a) => {
          const { data } = store.readTask(id);
          if (data.dept !== MANAGER_DEPT && a.dept !== data.dept) return text(`${data.dept}는 자기 부서 하위 항목만 고칠 수 있다. 다른 부서 것은 비서실에 맡긴다.`);
          try {
            const r = await store.saveUnit(a);
            await store.appendLog(id, `하위 항목 ${r.created ? '만듦' : '고침'}: [[${r.id}]]`);
            emit('vault', { changed: [r.rel] });
            return text(`${r.id} ${r.created ? '만들었다' : '고쳤다'} (${r.rel})`);
          } catch (e) { return text(`저장 못 함: ${e.message}`); }
        }),

      tool('save_process',
        '하위 항목의 작업 공정(단계 목록과 단계별 실행 정의)을 만들거나 고친다. steps.<단계> = {do: 세션 지시 | cmd: 명령, gate: 승인 필요, group: 렌더|LLM|업로드, check: 끝났다는 표시 경로}. 비서실은 모든 부서, 다른 부서는 자기 부서만.',
        {
          dept: z.string(),
          name: z.string().describe('공정 이름 (파일 이름, 예: 영화리뷰-제작)'),
          unit: z.string().nullable().optional().describe('하위 항목 이름'),
          title: z.string().optional(),
          summary: z.string().nullable().optional(),
          stages: z.array(z.string()).optional().describe('단계 이름 목록 (순서대로)'),
          stage: z.string().nullable().optional().describe('지금 단계'),
          item: z.string().nullable().optional().describe('지금 작업물'),
          slug: z.string().nullable().optional().describe('작업물 폴더 이름 ({slug} 자리)'),
          workdir: z.string().nullable().optional(),
          status: z.enum(['가동', '정지']).optional(),
          auto: z.boolean().nullable().optional(),
          steps: z.record(z.string(), z.object({
            do: z.string().optional(), cmd: z.string().optional(), gate: z.boolean().optional(), group: z.string().optional(),
            check: z.union([z.string(), z.array(z.string())]).optional(),
          })).nullable().optional(),
          body: z.string().optional().describe('본문 마크다운 전체 (단계 표·작업 환경). 주면 본문을 바꾼다'),
        },
        async (a) => {
          const { data } = store.readTask(id);
          if (data.dept !== MANAGER_DEPT && a.dept !== data.dept) return text(`${data.dept}는 자기 부서 공정만 고칠 수 있다. 다른 부서 것은 비서실에 맡긴다.`);
          try {
            const r = await store.saveProcess(a);
            await store.appendLog(id, `공정 ${r.created ? '만듦' : '고침'}: ${a.dept}/${r.id}`);
            emit('vault', { changed: [r.rel] });
            return text(`공정 ${r.id} ${r.created ? '만들었다' : '고쳤다'} (${r.rel})`);
          } catch (e) { return text(`저장 못 함: ${e.message}`); }
        }),
    ];
    const server = createSdkMcpServer({ name: 'brain', tools, alwaysLoad: true });
    // 테스트의 가짜 세션이 도구를 직접 부를 수 있게 (SDK로는 넘어가지 않음)
    Object.defineProperty(server, 'brainTools', { value: tools, enumerable: false });
    return server;
  }

  // 작업이 부서의 하위 항목에 속하면 그 항목 설명도 붙인다
  function unitRules(task) {
    if (!task.unit) return [];
    const u = store.units(task.dept).find((x) => x.name === task.unit);
    return u ? ['', `## 하위 항목: ${task.dept} › ${u.name}`, u.rules] : [];
  }

  // 기억 카드: 사람이 승인한 규칙 가운데 이 작업의 부서·하위 항목에 맞는 것 (모두 대상인 카드 포함, 최근 40개)
  function memoryCards(task) {
    const cards = (store.listCards?.() ?? [])
      .filter((c) => c.status === '사용' && (!c.dept || c.dept === task.dept) && (!c.unit || c.unit === task.unit))
      .slice(0, 40);
    if (!cards.length) return [];
    return ['', '## 기억 카드 — 사람이 정한 규칙 (반드시 지킨다)', ...cards.map((c) => `- ${c.rule} ([[${c.id}]])`)];
  }

  // 이름이 지시 첫머리를 자른 것 그대로인가 (createTask가 title 없이 만든 작업)
  function autoTitled(id, task) {
    try {
      const instruction = store.readTask(id).body.split('## 진행 로그')[0].replace('## 지시', '').trim();
      return !!instruction && task.title === shortTitle(instruction);
    } catch { return false; }
  }

  function systemAppend(id, task, dept) {
    const common = fs.readFileSync(path.join(store.root, 'CLAUDE.md'), 'utf8');
    return [
      '# SYNAPSE BRAIN 작업 세션',
      `너는 SYNAPSE BRAIN의 ${dept.name}다. 지금 작업은 ${id} "${task.title}"이고, 작업 파일은 ${path.join(store.root, '작업', `${id}.md`)} 이다.`,
      '작업·결정 파일은 직접 고치지 않고 mcp__brain__ 도구로만 바꾼다:',
      '- log_progress: 단계마다 한 줄 기록',
      '- request_decision: 사람이 골라야 할 때. 부른 뒤 턴을 끝낸다',
      '- create_task: 다른 부서 일',
      '- write_report: 보고서 파일',
      '- rename_task: 사용자가 이 작업 이름을 바꿔 달라고 할 때 (다른 부서에 맡기지 말고 직접)',
      '- note_learning: 일하다 새로 알게 된 방법·주의점(오류와 해결)·사람 선호를 한 줄로 — 쌓이면 스킬이 된다. 사람이 고쳐 말하면 꼭 남긴다',
      '- submit_result: 끝낼 때 반드시 한 번',
      // 화면 입력창으로 만든 작업은 이름이 지시 첫머리라서, 첫 실행 때 짧은 이름을 붙이게 한다
      ...(autoTitled(id, task) ? ['', `**지금 이름 "${task.title}"은 지시 첫머리를 자른 임시 이름이다.** 일을 시작하며 rename_task로 한 번, 무슨 일인지 알 수 있는 20자 안팎의 명사형 이름을 붙인다 (예: "경쟁사 주간 동향 리서치", "영혼의 카니발 나레이션"). 대상(작품·사람·폴더)을 앞에, 할 일을 뒤에. 문장·존댓말·따옴표·작업 번호는 넣지 않는다.`] : []),
      '',
      '## 공통 규칙 (vault/CLAUDE.md)',
      common,
      `## ${dept.name} 규칙`,
      dept.rules,
      ...unitRules(task),
      ...memoryCards(task),
    ].join('\n');
  }

  async function canUseTool(id, toolName, input, { signal }) {
    const shown = JSON.stringify(input, null, 2);
    const did = await store.createDecision({
      task: id, kind: '권한', title: `권한 요청: ${toolName}`, options: ['허용', '거부'], recommended: null,
      background: `도구 \`${toolName}\`을(를) 쓰려 한다.\n\n\`\`\`json\n${shown.length > 1500 ? `${shown.slice(0, 1500)}\n…` : shown}\n\`\`\``,
    });
    emit('decision', { id: did, task: id });
    const choice = await new Promise((resolve) => {
      waiters.set(did, resolve);
      signal.addEventListener('abort', () => resolve(2), { once: true });
    });
    waiters.delete(did);
    return choice === 1
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: '사용자가 거부했다. 다른 방법을 찾거나 request_decision으로 물어본다.' };
  }

  async function run(id, prompt) {
    const abort = new AbortController();
    // 실행 정보: 시작 시각·마지막 신호·도구 수·지금 단계 (화면의 세션 카드용)
    const info = { abort, phase: '실행', startedAt: Date.now(), lastSignal: Date.now(), tools: 0, step: '세션 여는 중' };
    live.set(id, info);
    emit('runtime', { id, phase: '실행' });
    let reported = false;
    try {
      const { data: task } = store.readTask(id);
      const dept = store.dept(task.dept);
      const q = queryFn({
        prompt,
        options: {
          cwd: dept.workdir,
          additionalDirectories: [store.root],
          model: dept.model ?? DEFAULT_MODEL,
          effort,
          permissionMode,
          resume: task.session ?? undefined,
          abortController: abort,
          systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend(id, task, dept) },
          mcpServers: { brain: brainServer(id) },
          allowedTools: BRAIN_TOOLS.map((t) => `mcp__brain__${t}`),
          canUseTool: (name, input, opts) => canUseTool(id, name, input, opts),
          hooks: { PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [async (input) => protectVault(input)] }] },
          stderr: () => {},
          // 세션 프로세스 pid를 기억해 둔다 — 사용량 측정기가 이 pid의 프로세스 나무를 작업 몫으로 센다
          spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
            const child = spawn(command, args, { cwd, env: { ...env, BRAIN_TASK: id }, signal, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
            child.stderr.resume();
            info.pid = child.pid;
            return child;
          },
        },
      });
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init' && m.session_id !== task.session) {
          await store.patchTask(id, { session: m.session_id });
        } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
          for (const b of m.message.content) {
            if (b.type === 'text' && b.text.trim()) {
              lastText.set(id, b.text.trim());
              info.lastSignal = Date.now(); info.step = '답 쓰는 중'; info.tool = null;
              emit('text', { id, text: b.text });
            } else if (b.type === 'tool_use') {
              if (b.name === 'mcp__brain__submit_result' || b.name === 'mcp__brain__request_decision') reported = true;
              // 지금 하는 일은 한국어 문장으로 (화면에 도구 원이름을 말로 띄우지 않는다). 원이름은 tool.name에
              info.tools += 1; info.lastSignal = Date.now();
              info.tool = { name: b.name, arg: argOf(b.input) };
              info.step = koNow(info.tool, '작업중');
              emit('tool', { id, name: b.name, label: toolLabel(b.name, 1), now: info.step });
            }
          }
        } else if (m.type === 'result') {
          if (m.subtype !== 'success') await store.appendLog(id, `⚠ 세션 오류로 멈춤 (${m.subtype})`);
          else if (/not logged in/i.test(m.result ?? '')) throw new Error('Claude Code 로그인이 필요함');
          // 마지막 실행 결과(시간·턴·비용 추정·토큰)를 남겨 둔다
          lastRun.set(id, { ms: m.duration_ms, turns: m.num_turns, cost: m.total_cost_usd, tokens: ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((n, k) => n + (m.usage?.[k] ?? 0), 0), at: Date.now() });
          emit('result', { id, subtype: m.subtype, cost: m.total_cost_usd });
        }
      }
    } catch (e) {
      reported = false;
      await store.appendLog(id, abort.signal.aborted ? '사용자가 멈춤' : `⚠ 오류: ${e.message}`).catch(() => {});
    }

    // 보고 없이 끝났고 더 받을 메시지가 없으면 사람에게 넘긴다.
    // 마무리 기록을 다 쓸 때까지는 실행 중으로 둬서, 그사이 온 메시지가 겹쳐 시작되지 않게 한다
    const { data: after } = store.readTask(id);
    if (!(inbox.get(id) ?? []).length && after.status === '실행중' && !reported) {
      await store.appendLog(id, '세션이 결과 보고 없이 끝남 → 검수');
      await store.patchTask(id, { status: '검수' });
    }
    live.delete(id);
    const pending = inbox.get(id) ?? [];
    if (pending.length) {
      inbox.delete(id);
      enqueue(id, pending.join('\n\n'));
    }
    emit('runtime', { id, phase: null });
    emit('task', { id });
    pump();
  }

  function enqueue(id, prompt) {
    queue.push({ id, prompt });
    live.set(id, { abort: null, phase: '대기열' });
    emit('runtime', { id, phase: '대기열' });
    pump();
  }

  function pump() {
    while (queue.length && runningCount() < maxRunning) {
      const { id, prompt } = queue.shift();
      run(id, prompt);
    }
  }

  // 첫 실행: 작업의 지시문을 그대로 준다
  function start(id) {
    const { body } = store.readTask(id);
    const instruction = body.split('## 진행 로그')[0].replace('## 지시', '').trim();
    enqueue(id, instruction);
  }

  // 사용자 메시지: 실행 중이면 끝난 뒤 이어서 보낸다
  async function send(id, message) {
    const { data } = store.readTask(id);
    if (['완료', '취소'].includes(data.status)) throw Object.assign(new Error(`${data.status}된 작업`), { status: 409 });
    await store.appendLog(id, `사용자: ${message.slice(0, 80)}`);
    if (live.has(id)) {
      inbox.set(id, [...(inbox.get(id) ?? []), message]);
      return '대기';
    }
    if (data.status !== '실행중') await store.patchTask(id, { status: '실행중' });
    if (!data.session) start(id); else enqueue(id, message);
    return '시작';
  }

  async function answer(decisionId, choice, note) {
    const { decision, taskId } = await store.answerDecision(decisionId, choice, note);
    emit('decision', { id: decisionId, task: taskId });
    const waiter = waiters.get(decisionId);
    if (waiter) { waiter(choice); return decision; }
    const picked = decision.options[choice - 1];
    const msg = decision.kind === '권한'
      ? `[${decisionId}] ${decision.title} → 사용자가 "${picked}"을(를) 골랐다.${decision.note ? ` 메모: ${decision.note}` : ''} 이어서 진행한다.`
      : `[${decisionId}] "${decision.title}" → 사용자가 ${choice}번 "${picked}"을(를) 골랐다.${decision.note ? ` 메모: ${decision.note}` : ''} 이어서 진행한다.`;
    if (live.has(taskId)) inbox.set(taskId, [...(inbox.get(taskId) ?? []), msg]);
    else enqueue(taskId, msg);
    return decision;
  }

  function stop(id) {
    const x = live.get(id);
    if (!x) return false;
    if (x.abort) x.abort.abort();
    else {
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
      live.delete(id);
      emit('runtime', { id, phase: null });
    }
    return true;
  }

  return {
    start, send, answer, stop,
    runtime: (id) => ({
      phase: live.get(id)?.phase ?? null, lastText: lastText.get(id) ?? null,
      startedAt: live.get(id)?.startedAt ?? null, lastSignal: live.get(id)?.lastSignal ?? null,
      tools: live.get(id)?.tools ?? 0, step: live.get(id)?.step ?? null, now: live.get(id)?.step ?? null, tool: live.get(id)?.tool ?? null, lastRun: lastRun.get(id) ?? null, waitingPermission: [...waiters.keys()].filter((d) => linkTarget(store.readDecision(d).data.task) === id) }),
    idle: () => live.size === 0,
    // 지금 도는 세션들의 프로세스 pid (사용량 측정용)
    sessions: () => [...live].filter(([, x]) => x.phase === '실행' && x.pid).map(([id, x]) => ({ id, pid: x.pid, startedAt: x.startedAt })),
  };
}
