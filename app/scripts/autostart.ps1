# 로그인할 때 SYNAPSE BRAIN 서버가 저절로 켜지게 (Windows 작업 스케줄러)
#   .\autostart.ps1 install   등록 (지금 바로 한 번 켬)
#   .\autostart.ps1 remove    등록 해제 (켜져 있는 서버도 끔)
#   .\autostart.ps1 status    상태 보기
param([ValidateSet('install', 'remove', 'status')] [string]$Action = 'status')

$name = 'AI-Brain-Server'
$runner = Join-Path $PSScriptRoot 'run-server.ps1'

function Stop-Brain {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*run-server.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*server.mjs*' -and $_.ExecutablePath } |
    Where-Object { (Get-NetTCPConnection -OwningProcess $_.ProcessId -LocalPort 4747 -State Listen -ErrorAction SilentlyContinue) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

switch ($Action) {
  'install' {
    # 윈도우 11은 기본 터미널(Windows Terminal)이 -WindowStyle Hidden을 무시해 빈 창이 뜬다 → 창 없는 conhost로 띄운다
    $act = New-ScheduledTaskAction -Execute 'conhost.exe' `
      -Argument "--headless powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
    $trig = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $name -Action $act -Trigger $trig -Settings $set -Description 'SYNAPSE BRAIN 서버 (127.0.0.1:4747)' -Force | Out-Null
    Start-ScheduledTask -TaskName $name
    "등록함: 로그인할 때마다 서버가 켜져요. 지금도 켰어요 → http://127.0.0.1:4747"
  }
  'remove' {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
    Stop-Brain
    "해제함: 자동 시작을 지우고 서버를 껐어요."
  }
  'status' {
    $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($t) { "자동 시작: 등록됨 ($($t.State))" } else { "자동 시작: 없음" }
    $up = Get-NetTCPConnection -LocalPort 4747 -State Listen -ErrorAction SilentlyContinue
    if ($up) { "서버: 켜짐 → http://127.0.0.1:4747" } else { "서버: 꺼짐" }
  }
}
