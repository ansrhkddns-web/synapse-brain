# SYNAPSE BRAIN 켜고 끄기 (트레이 프로그램 desktop\SYNAPSE BRAIN.exe가 부른다)
#   .\brain-ctl.ps1 start          서버 켜기 (이미 켜져 있으면 그대로)
#   .\brain-ctl.ps1 stop           서버 끄기
#   .\brain-ctl.ps1 restart        서버 다시 켜기 (응답 없이 멈춰 있어도 강제로 끄고 켠다)
#   .\brain-ctl.ps1 auto-on        윈도우 로그인 때 자동으로 켜기 (서버 예약 작업 + 트레이를 시작 프로그램에)
#   .\brain-ctl.ps1 auto-off       자동으로 켜지 않기
#   .\brain-ctl.ps1 status         상태 (up/down, auto on/off)
param([ValidateSet('start', 'stop', 'restart', 'auto-on', 'auto-off', 'status')] [string]$Action = 'status')

$name = 'AI-Brain-Server'
$runner = Join-Path $PSScriptRoot 'run-server.ps1'
$app = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $app 'desktop\SYNAPSE BRAIN.exe'
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'SYNAPSE BRAIN.lnk'

function Test-Up { [bool](Get-NetTCPConnection -LocalPort 4747 -State Listen -ErrorAction SilentlyContinue) }
function Get-Task { Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue }

function Register-Brain {
  # 윈도우 11 기본 터미널은 -WindowStyle Hidden을 무시해 빈 창이 뜬다 → 창 없는 conhost로 띄운다
  $act = New-ScheduledTaskAction -Execute 'conhost.exe' `
    -Argument "--headless powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
  $trig = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $name -Action $act -Trigger $trig -Settings $set -Description 'SYNAPSE BRAIN 서버 (127.0.0.1:4747)' -Force | Out-Null
}

function Stop-Brain {
  if (Get-Task) { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*run-server.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*server.mjs*' -and $_.ExecutablePath } |
    Where-Object { (Get-NetTCPConnection -OwningProcess $_.ProcessId -LocalPort 4747 -State Listen -ErrorAction SilentlyContinue) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-Brain {
  $t = Get-Task
  if (-not $t) { Register-Brain; $t = Get-Task }
  if (-not $t.Settings.Enabled) {
    # 자동 시작을 꺼 둔 상태 — 예약 작업은 놔두고 같은 실행기를 바로 띄운다
    Start-Process conhost.exe -ArgumentList "--headless powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"" -WindowStyle Hidden
  } else {
    Start-ScheduledTask -TaskName $name
  }
}

switch ($Action) {
  'start' {
    if (Test-Up) { 'up'; break }
    Start-Brain
    'starting'
  }
  'stop' { Stop-Brain; 'down' }
  'restart' {
    Stop-Brain
    # 남은 node가 4747을 붙잡고 있으면 그것도 끈다 (응답 없이 멈춘 서버)
    Get-NetTCPConnection -LocalPort 4747 -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 20 -and (Test-Up); $i++) { Start-Sleep -Milliseconds 250 }
    Start-Brain
    'starting'
  }
  'auto-on' {
    if (-not (Get-Task)) { Register-Brain }
    Enable-ScheduledTask -TaskName $name | Out-Null
    if (Test-Path $exe) {
      $sh = (New-Object -ComObject WScript.Shell).CreateShortcut($startup)
      $sh.TargetPath = $exe; $sh.Arguments = '--tray'; $sh.WorkingDirectory = Split-Path $exe; $sh.Save()
    }
    'auto on'
  }
  'auto-off' {
    if (Get-Task) { Disable-ScheduledTask -TaskName $name | Out-Null }
    if (Test-Path $startup) { Remove-Item $startup }
    'auto off'
  }
  'status' {
    $t = Get-Task
    "$(if (Test-Up) { 'up' } else { 'down' }) $(if ($t -and $t.Settings.Enabled) { 'auto-on' } else { 'auto-off' })"
  }
}
