# PC 사용량 재기 — lib/monitor.mjs가 낮은 우선순위로 띄워 두고 한 줄씩 읽는다.
# $Interval초마다 JSON 한 줄: procs(프로세스별 CPU%·전용 메모리·GPU 엔진 사용률·GPU 전용 메모리·부모 pid), gpu(nvidia-smi 전체 값)
# PowerShell을 매번 새로 띄우면 한 번에 2초가 넘게 걸려서, 한 프로세스가 돌면서 잰다.
param([int]$Interval = 4)
$ErrorActionPreference = 'SilentlyContinue'
# 명령줄의 한글 경로가 깨지지 않게 (기본 콘솔 코드 페이지는 CP949)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$smi = (Get-Command nvidia-smi -ErrorAction SilentlyContinue).Source
$aiNames = '^(claude|python|pythonw|ffmpeg|ffprobe|ollama|llama-server|node|whisper.*|comfy.*|codex)\.exe$'

while ($true) {
  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Property IDProcess, PercentProcessorTime, WorkingSetPrivate
  $tree = @{}
  foreach ($p in Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine) { $tree[[int]$p.ProcessId] = $p }
  # GPU 엔진 사용률: 작업 관리자처럼 엔진 종류별로 더한 뒤 가장 큰 값
  $eng = @{}
  foreach ($e in Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Property Name, UtilizationPercentage) {
    if ($e.UtilizationPercentage -le 0) { continue }
    if ($e.Name -match '^pid_(\d+)_.*engtype_(.+)$') { $k = "$($Matches[1])|$($Matches[2])"; $eng[$k] = [double]$eng[$k] + $e.UtilizationPercentage }
  }
  $gpuPid = @{}
  foreach ($k in $eng.Keys) { $id = [int](($k -split '\|')[0]); if ($eng[$k] -gt [double]$gpuPid[$id]) { $gpuPid[$id] = $eng[$k] } }
  $vram = @{}
  foreach ($m in Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -Property Name, DedicatedUsage) {
    if ($m.Name -match '^pid_(\d+)_') { $id = [int]$Matches[1]; $vram[$id] = [double]$vram[$id] + $m.DedicatedUsage }
  }
  $procs = foreach ($p in $perf) {
    $id = [int]$p.IDProcess
    $t = $tree[$id]
    if ($id -eq 0 -or -not $t) { continue }
    # 명령줄: AI 일을 하는 프로그램만 (어느 부서 일인지 경로로 가려 낸다 — lib/activity.mjs)
    $cmd = $null
    if ($t.Name -match $aiNames -and $t.CommandLine) { $cmd = ([string]$t.CommandLine).Substring(0, [Math]::Min(600, ([string]$t.CommandLine).Length)) }
    [pscustomobject]@{ pid = $id; ppid = [int]$t.ParentProcessId; name = [string]$t.Name; cpu = [double]$p.PercentProcessorTime; mem = [double]$p.WorkingSetPrivate; gpu = [double]$gpuPid[$id]; vram = [double]$vram[$id]; cmd = $cmd }
  }
  $gpu = $null
  if ($smi) {
    $row = (& $smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits | Select-Object -First 1) -split ',\s*'
    if ($row.Count -ge 5) { $gpu = @{ name = $row[0]; util = [double]$row[1]; memUsed = [double]$row[2] * 1MB; memTotal = [double]$row[3] * 1MB; temp = [double]$row[4] } }
  }
  [Console]::Out.WriteLine((@{ at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); procs = @($procs); gpu = $gpu } | ConvertTo-Json -Compress -Depth 3))
  [Console]::Out.Flush()
  Start-Sleep -Seconds $Interval
}
