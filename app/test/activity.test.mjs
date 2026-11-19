import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, makeRules, parseTranscript, readPrograms } from '../lib/activity.mjs';

const rules = makeRules({
  depts: [
    { name: '영상편집부', workdir: 'D:\\AI Project\\영상편집' },
    { name: '개발부', workdir: 'D:\\AI Project', match: ['D:\\AI Project\\인공두뇌프로젝트\\app'] },
    { name: '자원관리부', workdir: 'D:\\AI Project' },
    { name: '번역부', workdir: 'D:\\AI Project\\일본어 영상번역' },
  ],
  units: [
    { dept: '영상편집부', name: '영화리뷰', workdir: 'D:\\AI Project\\영상편집\\3. Work\\cache\\영화리뷰' },
    { dept: '영상편집부', name: '몬티', match: ['\\episodes\\E2'] },
    { dept: '번역부', name: 'JAV 제목번역', workdir: 'E:\\AI Project\\javManager' },
  ],
  processes: [{ id: '영화리뷰-제작', dept: '영상편집부', unit: '영화리뷰', workdir: 'D:\\AI Project\\영상편집\\3. Work\\cache\\영화리뷰\\carnival_of_souls' }],
});

test('경로로 부서·하위 항목·공정을 가린다 (구체적인 규칙이 이기고, 함께 쓰는 workdir은 무시)', () => {
  assert.deepEqual(classify(rules, ['D:\\AI Project', 'D:/AI Project/영상편집/3. Work/cache/영화리뷰/x/sheet.png']), { dept: '영상편집부', unit: '영화리뷰', proc: null });
  assert.deepEqual(classify(rules, ['D:\\AI Project\\영상편집\\3. Work\\cache\\영화리뷰\\carnival_of_souls\\tts']), { dept: '영상편집부', unit: '영화리뷰', proc: '영화리뷰-제작' });
  assert.equal(classify(rules, ['D:\\AI Project\\영상편집\\2. Tools\\s3-studio\\episodes\\E284.js']).unit, '몬티');
  assert.equal(classify(rules, ['D:\\AI Project\\인공두뇌프로젝트\\app\\lib\\x.mjs']).dept, '개발부');
  assert.equal(classify(rules, ['D:\\AI Project', 'C:\\Windows']).dept, null);
});

const rec = (o) => JSON.stringify(o);
test('대화 기록: 제목·지금 도구·경로·작업 언급, 턴이 끝났는지', () => {
  const base = { cwd: 'D:\\AI Project', sessionId: 's1' };
  const lines = [
    rec({ ...base, type: 'user', timestamp: '2026-11-01T00:30:00Z', message: { role: 'user', content: '<system-reminder>x</system-reminder>W-261101-004 영화 렌더 이어서' } }),
    rec({ ...base, type: 'assistant', timestamp: '2026-11-01T00:30:05Z', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'D:\\AI Project\\영상편집\\3. Work\\cache\\영화리뷰\\a\\sheet.png' } }] } }),
    rec({ type: 'custom-title', customTitle: '- 스토리뷰 (몬티3)', sessionId: 's1' }),
  ];
  const a = parseTranscript(lines.join('\n'));
  assert.equal(a.title, '스토리뷰 (몬티3)');
  assert.equal(a.prompt, 'W-261101-004 영화 렌더 이어서');
  assert.deepEqual(a.tool, { name: 'Read', arg: 'sheet.png' });
  assert.equal(a.ended, false);
  assert.deepEqual(a.taskRefs, ['W-261101-004']);
  assert.ok(a.paths.some((p) => p.endsWith('sheet.png')));
  const b = parseTranscript([...lines, rec({ ...base, type: 'assistant', timestamp: '2026-11-01T00:31:00Z', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '끝났어요' }] } }), rec({ type: 'system', subtype: 'stop_hook_summary' })].join('\n'));
  assert.equal(b.ended, true);
  assert.equal(b.text, '끝났어요');
});

test('프로그램: 세션 아래 것은 세션에, 경로 없는 node는 자식 자리를 따르고, 두뇌 서버 아래는 뺀다', () => {
  const p = (pid, ppid, name, cmd, cpu = 0, gpu = 0) => ({ pid, ppid, name, cmd, cpu, gpu, mem: 0, vram: 0 });
  const sample = {
    procs: [
      p(10, 1, 'claude.exe', 'claude.exe --output-format stream-json --resume=0a5b6c7d-1111-2222-3333-444455556666'),
      p(11, 10, 'powershell.exe', null),
      p(12, 11, 'ffmpeg.exe', 'ffmpeg -i "D:\\AI Project\\영상편집\\3. Work\\cache\\영화리뷰\\a\\in.mp4" out.mp4', 400),
      p(20, 2, 'node.exe', '"C:\\Program Files\\nodejs\\node.exe" --no-warnings server\\index.mjs', 40),
      p(21, 20, 'ollama.exe', '"E:\\AI Project\\javManager\\tool\\translate\\ollama\\ollama.exe" serve', 0, 90),
      p(30, 3, 'node.exe', 'node server.mjs'),
      p(31, 30, 'python.exe', 'python D:\\AI Project\\영상편집\\x.py', 200),
      p(40, 4, 'python.exe', 'python C:\\tmp\\idle.py', 1),
    ],
  };
  const r = readPrograms(sample, { rules, serverPid: 30, cores: 4, ramTotal: 100 });
  const by = Object.fromEntries(r.programs.map((g) => [g.name, g]));
  assert.equal(by.ffmpeg.session, '0a5b6c7d-1111-2222-3333-444455556666');
  assert.equal(by.ffmpeg.unit, '영화리뷰');
  assert.equal(by.ffmpeg.cpu, 100);
  assert.equal(by.node.unit, 'JAV 제목번역');     // 자식 ollama 자리를 따름
  assert.equal(by.node.gpu, 90);                  // ollama는 node 묶음 안에서 센다
  assert.equal(r.programs.length, 2);             // 두뇌 서버 아래 python·조용한 미분류 python은 빠짐
  assert.equal(r.sessionShare('0a5b6c7d-1111-2222-3333-444455556666').cpu, 100);
});
