$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$env:PATH = 'C:\Windows\System32;C:\Windows'
& (Join-Path $root 'scripts\workbuddy-skin.ps1') -Action Verify
if ($LASTEXITCODE -ne 0) { throw 'Portable runtime verification failed.' }
$runtime = Join-Path $env:LOCALAPPDATA 'WorkBuddySkin\runtime\node.exe'
if (-not (Test-Path -LiteralPath $runtime)) { throw 'Portable Node runtime was not extracted.' }
Write-Host "PASS: portable WorkBuddy Node runtime fallback is available at $runtime"
