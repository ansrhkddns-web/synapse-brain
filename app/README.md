# app — SYNAPSE BRAIN 서버와 도구

## 처음 한 번

Agent SDK가 쓰는 Claude Code에 로그인한다(브라우저가 열림). 데스크톱 앱의 로그인과는 따로다.

```powershell
& "{{BRAIN}}\app\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe" auth login
```

## 명령 (이 폴더에서)

| 명령 | 하는 일 |
|---|---|
| `npm start` | 서버 켜기 — 화면은 http://127.0.0.1:4747 (이 PC에서만) |
| `web/`에서 `npm run build` | 화면 다시 빌드 (`web/dist`, 서버가 그대로 제공) |
| `web/`에서 `npm run dev` | 화면 개발 서버 http://127.0.0.1:5173 (API는 4747로 넘김) |
| `npm test` | 테스트 (가짜 세션, Claude 호출 없음) |
| `npm run check` | 보관함 형식 검사 |
| `scripts\autostart.ps1 install` / `remove` / `status` | 로그인 때 서버 자동 시작 등록·해제·상태 (작업 스케줄러 `AI-Brain-Server`, 로그 `logs/`) |
| `desktop\SYNAPSE BRAIN.exe` | 윈도우 프로그램 — 자기 창 안에 화면(WebView2). 창을 닫으면 트레이로 숨고 서버는 계속, 트레이 오른쪽 클릭으로 서버 켜기·끄기·다시 시작·자동 시작·종료. 코드 `desktop\BrainApp\` (.NET 10 WinForms), 다시 만들기: `desktop\build.ps1` (바탕화면·시작 메뉴 바로가기도). 켜고 끄기는 `scripts\brain-ctl.ps1 start\|stop\|auto-on\|auto-off\|status` |
| `node server.mjs --no-schedule` | 예약 실행기 없이 서버만 (화면 확인용) |
| `node scripts/smoke-sdk.mjs <빈 폴더>` | SDK 로그인·도구 호출 시험 (실제 호출, 비용 조금) |

## 설치에 대해

- SDK의 Windows 실행 파일(약 140MB)은 회선을 다 쓰지 않도록 `curl --limit-rate`로 받아 `vendor/`에 두고 거기서 설치했다.
- 화면 패키지(`web/`)는 `npm install --package-lock-only`로 목록만 만든 뒤 88개를 하나씩 `curl --limit-rate 4M`로 받아 npm 캐시에 넣고 `npm ci --offline`으로 설치했다. 패키지를 늘릴 때도 같은 방식.
- Node 24의 `fs.rmSync({recursive})`가 이 한글 경로에서 프로세스째 죽는다(0xC0000409). 그래서 Vite의 `emptyOutDir`을 끄고 `web/scripts/clean-dist.mjs`가 `dist`를 비운다. 폴더를 통째 지우는 코드를 새로 쓸 때도 주의.
- `.npmrc`의 `omit=optional` 때문에 `npm install`이 다른 OS용 실행 파일을 다시 받지 않는다. SDK를 올릴 때도 같은 방식으로 `vendor/`에 받아 설치한다.

## 구조

| 파일 | 내용 |
|---|---|
| `server.mjs` | HTTP API + 실시간 이벤트(SSE). Host가 127.0.0.1·localhost가 아니면 403 |
| `lib/vault.mjs` | 보관함 읽기·형식 검사 |
| `lib/store.mjs` | 보관함 쓰기(작업·결정·보고서·진행 로그), 쓰기는 한 줄로 차례 처리 |
| `lib/runner.mjs` | 작업 1개 = SDK 세션 1개. brain 도구(`save_unit`·`save_process`로 하위 항목·공정 만들기 — 비서실은 모든 부서, 다른 부서는 자기 부서, 형식 오류면 되돌림), 권한 요청 → 결정 카드, 작업 파일 직접 쓰기 차단 |
| `lib/index.mjs` | `[[링크]]` 역링크, 전체 검색, 지도용 그래프, 파일 감시 |
| `lib/memlog.mjs`, `web/src/MemoryHome.jsx`, `web/src/DocBody.jsx` | 기억 탭(#/memory): **한눈에 = 기억 정리**(`lib/memrank.mjs`가 문서마다 층 지금·기준·결과·흔적 / 출처 내 손·세션·자동 / 무게 0~100과 까닭을 매김 — 필요한 것과 흔적을 나눠 보여 주고, 핵심 고정·흔적 내리기는 `기억/분류.json`에 남김. 흔적 층에서는 날짜별 원문 시간줄, 서버가 몇 분 안에 몰아 쌓은 판정은 한 줄로 묶음) · 그래프 · 기억 카드. 마지막에 본 탭을 기억한다. 문서 보기는 파일을 고치지 않고 화면에서만 다듬는다(`web/src/docfmt.js`): 맨 앞 `# 제목` 빼기, 작업 칸 안 머리말을 ### 아래로, 결과 끝 경로·보고서 목록은 "결과물" 묶음(파일 이름·폴더·복사), `- 09:46 …` 시각 칸, `[[W-…]]`에 문서 이름, ```` ```card ```` 데이터 접기. 기억 문서(주인말·검수·세션지시)는 같은 시간줄로 |
| `lib/monitor.mjs`, `scripts/usage.ps1` | PC 사용량 측정기 (자원관리부 / PC사용량). 세션 pid 나무를 작업 몫으로 센다 |
| `lib/schedule.mjs`, `lib/scheduler.mjs` | 예약 형식 읽기·때 계산, 30초마다 대기예약 작업 실행 |
| `lib/external.mjs` | 바깥에서 도는 일(두뇌가 띄우지 않은 Claude Code 세션의 녹음·렌더 등). `external/<작업 id>.json` 신호가 10분 안이면 화면에 "작업 중"(바깥 작업), 1분 넘게 조용하면 "멈춤 의심" |
| `lib/taxcal.mjs`, `web/src/TaxCalendar.jsx` | 세무달력(경영지원실 / 재경부, 지도의 경영지원실 → 재경부 아래 세무달력 카드 → #/calendar): 경영지원실 workdir의 `<회사>재경부세무달력.yaml` 반복 규칙(매월·말일·매년·날짜)을 날짜로 펼치고 토·일·공휴일이면 다음 평일로. 회사 유형·지급 여부·분류로 거르고, 날짜를 누르면 할 일·어디서·준비할 것·근거, "제출함"은 같은 폴더 `세무달력_완료.json` |
| `lib/checks.mjs` | 문서 대조: 공정 `steps.<단계>.check`(끝났다는 표시 경로, `{slug}`·`{workdir}`·`*`, 끝이 `\`면 비어 있지 않은 폴더)가 실제로 있는지 — 문서의 지금 단계보다 앞선 산출물(`ahead`)·지난 단계인데 없는 것(`missing`). `/api/state`의 공정마다 `verify` |
| `lib/tokens.mjs` | Claude 사용량(ccusage 방식): 대화 기록의 usage를 응답 id로 한 번만 세어 오늘·최근 5시간·세션별·모델별 토큰. 커진 만큼만 이어 읽는다 |
| `lib/notify.mjs` | 알림: 15초마다 확인할 것(결정·공정 승인/실패·검수·멈춤 의심·입력 대기)을 비교해 새로 생긴 것만 윈도우 알림, `app/notify.json`에 `ntfy` 주소를 넣으면 휴대폰(ntfy 앱)으로도. 실제 서버(`node server.mjs`)일 때만 켜짐, `--no-notify`로 끔 |
| `lib/pipeline.mjs` | 공정 실행기: 공정 문서 `steps`의 단계를 하나씩 — `do`는 그 부서 앞 작업을 만들어 두뇌 세션이, `cmd`는 작업 폴더에서 낮은 우선순위로. `gate`면 끝난 뒤 승인 대기, `auto`면 다음 단계를 바로. 그룹(렌더·LLM·업로드)마다 동시 1개, 나머지는 대기열. 상태(`phase`·`run`·`stage`)를 공정 문서에 적어 서버를 다시 켜도 이어진다 |
| `lib/hooks.mjs`, `scripts/hook.mjs` | Claude Code 훅 받기: 전역 훅이 사건(시작·사람 말·도구·알림·턴 끝·종료)을 `POST /api/hooks`로 보내면 세션 상태(작업중·입력대기·쉬는중·끝남)를 바로 알고, 답으로 **멈추기**(다음 도구 전 `continue:false`)·**지시 잇기**(Stop에 `decision:block`, 쉬는 중이면 다음 턴에 붙임)를 한다. 세션 시작 때 그 폴더의 부서·하위·공정 문서 경로를 알려 준다. 서버가 꺼져 있으면 훅은 아무것도 안 한다 |
| `scripts/beat.mjs`, `scripts/brainbeat.py` | 바깥 일 신호 남기기 (Node CLI / 파이썬). `done`·`total`·`unit`을 주면 화면에 진행 막대·%·남은 시간 |
| `scripts/ffprog.mjs <id> [--step] [--duration] -- <ffmpeg 인자>` | ffmpeg 대신 띄우기: `-progress`로 진행률 신호, BelowNormal·`-threads 10`, 중지 버튼 → 'q'로 깔끔히 끝냄. ffmpeg는 `FFMPEG` 환경 변수 → 영상편집 공용 ffmpeg → PATH |
| `lib/worklog.mjs`, `scripts/worklog-backfill.mjs` | Claude 작업 기록: 훅으로 Claude Code 세션 하나 = 작업 하나(태그 `바깥세션`·`cc-<세션 id>`). 사람 말 → 실행중 + 로그, 턴 끝 → 검수 + 마지막 답. 부서는 세션을 연 폴더 → 만진 경로 → 말의 낱말(`match`) 순, 이름은 세션 제목(사람이 바꾸면 `자동이름` 태그가 빠짐). 훅이 놓친 세션은 `node scripts/worklog-backfill.mjs --since 2026-11-02T17:00`으로 채운다 |
| `scripts/hooks.mjs install` / `remove` / `status` | 전역 훅 설치·해제 (`~/.claude/settings.json`, 고치기 전 사본 `settings.json.brain-bak`) |
| `lib/activity.mjs` | PC 작업 추적: 두뇌가 띄우지 않은 Claude Code 세션(`~/.claude/projects/*/*.jsonl`, 최근 30분)과 AI 프로그램(측정기 표본의 명령줄)을 만지는 경로로 부서·하위 항목·공정(`workdir`·`match`)에 배정. 지도에 바깥 세션 카드·프로그램 칩·연계 선 |

## API

| 요청 | 내용 |
|---|---|
| `GET /api/state` | 부서·KPI·작업 목록(실행 상태 포함)·대기 중인 결정·확인 필요 수 |
| `POST /api/tasks` `{dept, instruction, title?, schedule?}` | 새 일 → 바로 세션 시작. `schedule`이 있으면 대기예약 |
| `POST /api/tasks/:id/run` | 예약 작업 지금 실행 (반복이면 하위 작업 생성) |
| `GET /api/graph` | 지도용: 모든 md 점(`nodes`, 트리 부모 `parent`)과 선(`edges`: tree·link) |
| `GET /api/timeline?dept=&limit=` | 모든 작업의 진행 로그를 최신순 사건으로 (`at`, `task`, `kind`: 결정·결과·오류 등) |
| `GET /api/tasks/:id` | 작업 내용·역링크·실행 상태 |
| `GET /api/tasks/:id/messages` | 세션 대화 기록 |
| `POST /api/tasks/:id/messages` `{text}` | 이어서 지시(실행 중이면 끝난 뒤 전달) |
| `POST /api/tasks/:id/status` `{status}` | 사람이 상태 변경(완료·취소 등) |
| `POST /api/tasks/:id/title` `{title}` | 사람이 이름 변경(한 줄, 60자까지) — 진행 로그·주인말 기억에 남음. 화면은 작업 제목을 눌러 고친다. 세션은 `rename_task`로 자기 작업만 |
| `POST /api/tasks/:id/stop` | 세션 멈춤 |
| `GET /api/decisions/:id`, `POST /api/decisions/:id` `{choice, note?}` | 결정 보기·답하기 |
| `GET /api/search?q=` / `GET /api/backlinks/:name` | 검색 / 역링크 |
| `GET /api/learn` · `POST /api/learn {text, kind, dept}` · `POST /api/learn/extract` · `POST /api/learn/propose` · `POST /api/learn/state/<L-id> {status: 모음|버림}` | 배움 → 스킬 (`lib/learn.mjs`, 기억 탭 「배움」): 배움은 `기억/배움-YYYY-MM-DD.md` 한 줄씩(세션 도구 `note_learning` · 평일 18:30 그날 기록에서 자동 추출 · 사람이 적음), 상태는 `기억/배움-상태.json`. 묶기는 결정 `kind: 스킬`("스킬로 만들까요?")을 올리고, 만든다를 고르면 스킬관리부 작업 「스킬 만들기·고치기 · <name>」이 바로 시작된다. 자동 묶기는 모인 배움 3개 이상·3일마다 |
| `GET /api/memory/rank` · `POST /api/memory/rank/<id> {mark: 핵심\|흔적\|null}` | 기억 정리: `{items: [{id, type, title, dept, layer, origin, score, grade, reasons: [{n, why}], size, sizeLabel, refs, said, inLogs, mark, time}], totals}` (무게순). 고친 분류는 `기억/분류.json`, 주인말에 "기억 분류" 줄 |
| `GET /api/memory?days=14` · `?name=주인말-2026-11-18` | 기억 기록(주인말·검수판정·세션지시) 항목: `{days: [{date, files, entries: [{time, source, kind, task, text, links}]}], refs: {id: {title, type, status, dept}}}` — 기록이 있는 날 최근 N개(최대 120) / 파일 하나 |
| `GET /api/check` | 형식 검사 결과 |
| `GET /api/usage` | PC 사용량: CPU·RAM·GPU 전체, 작업 세션별·프로그램별 몫 (보는 동안만 4초마다 잼) |
| `GET /api/activity` | PC 작업: `{sessions, programs}` — 세션은 상태(작업중·응답없음·쉬는중)·제목·지금 도구·부서/하위/공정·연계 작업, 프로그램은 묶음·몫·세션·부서 (보는 동안만) |
| `POST /api/processes/:id/run` · `approve {note?}` · `retry {note?}` · `next` · `stop` · `item {item, slug?, go?}` | 공정 실행기: 지금 단계 실행 · 승인하고 다음으로 · 같은 단계 다시(고칠 점을 붙여) · 사람 단계를 했으니 다음으로 · 멈춤(위치는 그대로) · 새 작업물로 처음부터 |
| `POST /api/units/command {unit, name}` | 하위 문서 `commands`의 명령 하나를 PowerShell로 (문서에 적힌 것만, 90초, BelowNormal) → `{code, out}` |
| `POST /api/processes/:id/stage {stage}` | 지금 단계를 바로 옮김 (문서 대조의 "맞추기") |
| `GET /api/taxcal` · `POST /api/taxcal/done {company, key, done}` | 세무달력: 회사별 규칙·펼친 일정·공휴일·오류 / 제출함 표시 |
| `GET /api/today` · `POST /api/today` | 일정비서 카드: `{date, title, intro, summary, sections}` — 섹션 → 대상 묶음(`{target, items, also}`) 또는 단독 카드 / 하위 문서를 지금 다시 씀 (`lib/today.mjs`) |
| `GET /api/tokens` | Claude 사용량: `{today, window(5시간), sessions, models}` 토큰 |
| `GET /api/notify` · `POST /api/notify/test` | 알림 설정·최근 보낸 것 / 시험 알림 |
| `POST /api/hooks` | 훅 사건 받기 (scripts/hook.mjs) → `{out}` = 훅 출력. 작업 기록·화면 알림은 응답을 보낸 뒤에 |
| `GET /api/sessions` | **데스크**: 두뇌·바깥·신호 세션을 한 모양으로 (`lib/sessions.mjs`) — `task`(보관함 상태) · `run`(실행 상태 `state`·한국어 `now`·`lastAnswer`) · `delivery`(보낸 지시: 접수→포함→관측) · `actions`(칩·안내 한 줄). 작업 기록 전 바깥 세션은 `cc:<세션 id>` |
| `GET /api/attention` | 내 차례: 행동 필요(결정·권한·입력대기·승인·실패·멈춤의심) + 새 답(검수·새답, `answer` 열쇠). 같은 작업은 하나로. 알림도 이 목록을 쓴다 |
| `GET /api/tasks/:id/evidence` | 결과 증거: 마지막 답·게시한 아티팩트·성공한 쓰기 파일·보고서·명령 수 (`lib/transcript.mjs`, 큰 기록은 끝 4MB만 → `range.partial`) |
| `POST /api/tasks/:id/review` `{verdict:'완료'\|'다시', answer, note?}` | 판정. `answer`가 지금 답과 다르면 409, 같은 판정 두 번은 한 번만, 공정 단계 작업은 409. 다시 → 이유를 세션에 전달(`[검수] 다시: …`) |
| `POST /api/activity/sessions/:id/control` `{stop?, message?}` / `.../cancel` | 바깥 세션 멈추기·지시 보내기 / 대기 명령 취소 (훅으로 연결된 세션만) |
| `POST /api/activity/programs/stop` `{key}` | 지금 목록에 있는 AI 프로그램 묶음을 프로세스 나무째 끝냄 |
| `GET /api/events` | 실시간 이벤트: `task` `text` `tool` `decision` `runtime` `result` `vault` |

## 세션 흐름

1. `POST /api/tasks` → 작업 파일 생성(실행중) → 부서의 `workdir`에서 세션 시작. 시스템 프롬프트에 공통 규칙 + 부서 규칙을 붙인다.
2. 부서가 `request_decision` → 결정 파일 + 작업 `결정대기` → 사람이 답하면 같은 세션을 resume 해서 답을 전한다.
3. 위험한 도구 사용은 `auto` 권한 모드가 거르고, 판단이 안 서면 `권한` 결정 카드(허용/거부)로 묻는다.
4. `submit_result` → 결과 기록 + `검수`. 보고 없이 끝나면 서버가 `검수`로 넘긴다. `완료`는 사람만.
5. 동시에 도는 세션은 3개까지, 나머지는 대기열.
6. 바깥 작업: `POST /api/tasks` `{start:false}`로 작업만 만들고, 바깥 일이 20초마다 `app/external/<id>.json`(`startedAt`·`beat`·`step`·`line`·`pid`·`stop`, 진행률 `done`·`total`·`unit`·`eta`, 끝 `finished`)을 쓴다. 신호가 1분 넘게 없으면 "멈춤 의심", 10분이면 내린다. 중지 버튼은 `stop` 경로에 파일을 만들 뿐이다(바깥 일이 스스로 멈춤). 예: 영상편집 s3-studio `tools/gfbeat.sh <id>`.
