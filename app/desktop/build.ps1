# SYNAPSE BRAIN.exe 만들기 (윈도우 프로그램: 자기 창 + WebView2 화면 + 트레이) + 바탕화면·시작 메뉴 바로가기
#   powershell -ExecutionPolicy Bypass -File desktop\build.ps1
#   필요한 것: .NET 10 SDK, WebView2 런타임(윈도우 11 기본)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$proj = Join-Path $here 'BrainApp\BrainApp.csproj'
$out = Join-Path $here 'BrainApp\publish'
$exe = Join-Path $here 'SYNAPSE BRAIN.exe'

# 떠 있는 프로그램은 먼저 닫는다 (exe를 덮어쓰려면)
Get-Process -Name 'SYNAPSE BRAIN' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

dotnet publish $proj -c Release -o $out --nologo -v quiet
if ($LASTEXITCODE) { throw 'dotnet publish 실패' }
Copy-Item -Force (Join-Path $out 'SYNAPSE BRAIN.exe') $exe

# 제어 스크립트는 PowerShell 5.1이 한글을 읽도록 BOM 붙은 UTF-8로
$ctl = Join-Path (Split-Path $here) 'scripts\brain-ctl.ps1'
$text = [IO.File]::ReadAllText($ctl, [Text.Encoding]::UTF8)
[IO.File]::WriteAllText($ctl, $text, (New-Object Text.UTF8Encoding $true))

# 바로가기: 바탕화면·시작 메뉴 (자동 시작이 켜져 있으면 시작 프로그램 바로가기도 새로)
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'SYNAPSE BRAIN.lnk'))
  $lnk.TargetPath = $exe; $lnk.WorkingDirectory = $here; $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'SYNAPSE BRAIN'
  $lnk.Save()
}
"만듦: $exe"
