# SYNAPSE BRAIN 서버를 낮은 우선순위로 돌리고, 죽으면 10초 뒤 다시 켠다.
# 로그: app\logs\server.log (1MB 넘으면 server.old.log로 넘김)
$app = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $app 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs 'server.log'

while ($true) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Move-Item -Force $log (Join-Path $logs 'server.old.log') }
  Add-Content -Encoding utf8 $log "=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 서버 시작"
  $p = Start-Process node -ArgumentList 'server.mjs' -WorkingDirectory $app -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'stdout.tmp') -RedirectStandardError (Join-Path $logs 'stderr.tmp')
  # 서버는 가벼운 관제 프로세스라 보통 우선순위로 둔다 — BelowNormal이면 렌더(블렌더 등)가 CPU를 다 쓸 때 응답이 멈춰
  # 훅(작업 기록)·화면이 함께 끊긴다. 무거운 일은 서버가 띄우는 세션·명령 쪽에서 낮춘다.
  try { $p.PriorityClass = 'Normal' } catch {}
  $p.WaitForExit()
  foreach ($f in 'stdout.tmp', 'stderr.tmp') {
    $t = Join-Path $logs $f
    if (Test-Path $t) { Get-Content -Encoding utf8 $t | Add-Content -Encoding utf8 $log; Remove-Item $t }
  }
  Add-Content -Encoding utf8 $log "=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 서버 종료 (코드 $($p.ExitCode)) — 10초 뒤 다시 켬"
  Start-Sleep -Seconds 10
}
