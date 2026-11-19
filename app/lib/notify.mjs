// 알림 (확인할 일이 새로 생기면): 윈도우 알림(기본 켬) + 휴대폰(ntfy, 설정했을 때만).
//   15초마다 "사람이 봐야 할 것" 목록을 만들어 지난번과 비교하고, 새로 생긴 것만 알린다 (켤 때 이미 있던 것은 알리지 않는다).
//   종류: 결정(고를 것) · 승인(공정 단계 승인 대기) · 실패(공정 단계) · 검수(작업 결과 확인할 차례) · 멈춤의심(바깥 일 신호 끊김) · 입력대기(바깥 세션, 기본 끔 — 데스크톱 앱이 이미 알림)
// 설정: app/notify.json  { "toast": true, "ntfy": "https://ntfy.sh/<내 주제>", "kinds": ["결정","승인","실패","검수","멈춤의심"] }
//   ntfy 주제 이름은 남이 짐작 못 하게 길게. 휴대폰에 ntfy 앱을 깔고 같은 주제를 구독하면 된다. 비워 두면 휴대폰으로는 안 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const KINDS = ['결정', '권한', '승인', '실패', '검수', '멈춤의심', '입력대기', '새답'];
const DEFAULT = { toast: true, ntfy: null, kinds: ['결정', '권한', '승인', '실패', '검수', '멈춤의심'] };
const POLL_MS = 15_000;
const MAX_BURST = 4;   // 한 번에 이보다 많이 생기면 하나로 묶는다

// 윈도우 알림: PowerShell로 토스트 (앱 등록 없이 PowerShell 이름으로 뜬다). 글은 환경 변수로 넘겨 따옴표 문제를 없앤다
const PS = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t = $x.GetElementsByTagName('text')
$t.Item(0).AppendChild($x.CreateTextNode($env:BRAIN_TITLE)) > $null
$t.Item(1).AppendChild($x.CreateTextNode($env:BRAIN_BODY)) > $null
$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))
`;
export function toast(title, body, spawnFn = spawn) {
  return new Promise((resolve) => {
    const c = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS], {
      windowsHide: true, stdio: 'ignore', env: { ...process.env, BRAIN_TITLE: title, BRAIN_BODY: body },
    });
    c.on('exit', (code) => resolve(code === 0));
    c.on('error', () => resolve(false));
  });
}

// 휴대폰: ntfy (제목은 헤더라 ASCII만 되므로 RFC 2047로 감싼다)
export async function ntfy(url, title, body, fetchFn = fetch) {
  try {
    const r = await fetchFn(url, { method: 'POST', body, headers: { Title: `=?UTF-8?B?${Buffer.from(title).toString('base64')}?=`, Tags: 'brain' }, signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}

export function createNotifier({ file, items, send = null, poll = POLL_MS, log = () => {} }) {
  let seen = null;   // 지난번 key 목록 (null = 아직 처음)
  const history = [];
  const config = () => {
    try { return { ...DEFAULT, ...JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) }; } catch { return { ...DEFAULT }; }
  };
  const deliver = send ?? (async (title, body, cfg) => {
    const out = [];
    if (cfg.toast) out.push(toast(title, body));
    if (cfg.ntfy) out.push(ntfy(cfg.ntfy, title, body));
    return (await Promise.all(out)).some(Boolean);
  });

  async function tick() {
    let list;
    try { list = items(); } catch (e) { log(`알림 목록 실패: ${e.message}`); return []; }
    const cfg = config();
    const keys = new Set(list.map((x) => x.key));
    if (seen == null) { seen = keys; return []; }
    const fresh = list.filter((x) => !seen.has(x.key) && cfg.kinds.includes(x.kind));
    seen = keys;
    if (!fresh.length) return [];
    const batch = fresh.length > MAX_BURST
      ? [{ kind: '여럿', title: `확인할 일 ${fresh.length}개`, body: fresh.slice(0, 5).map((x) => `${x.kind} · ${x.title}`).join('\n') }]
      : fresh;
    for (const x of batch) {
      const ok = await deliver(`[${x.kind}] ${x.title}`, x.body ?? '', cfg).catch(() => false);
      history.unshift({ at: new Date().toISOString(), kind: x.kind, title: x.title, ok });
    }
    history.splice(20);
    return batch;
  }
  const timer = poll ? setInterval(() => { tick(); }, poll) : null;
  timer?.unref?.();

  return {
    tick,
    config,
    status: () => { const c = config(); return { toast: c.toast, phone: !!c.ntfy, kinds: c.kinds, all: KINDS, history }; },
    test: async () => { const c = config(); return { ok: await deliver('[시험] SYNAPSE BRAIN 알림', '이 알림이 보이면 알림이 켜져 있습니다.', c) }; },
    close: () => timer && clearInterval(timer),
  };
}

export const NOTIFY_FILE = (appDir) => path.join(appDir, 'notify.json');
