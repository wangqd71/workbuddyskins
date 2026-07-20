[CmdletBinding()]
param(
  [ValidateSet('Apply', 'Restore', 'Status', 'Verify')]
  [string]$Action = 'Status',
  [switch]$RestartExisting,
  [string]$ScreenshotPath
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StateRoot = Join-Path $env:LOCALAPPDATA 'WorkBuddySkin'
$StatePath = Join-Path $StateRoot 'state.json'
$InjectorPath = Join-Path $PSScriptRoot 'injector.mjs'
$CssPath = Join-Path $Root 'assets\miku\theme.css'
$HeroPath = Join-Path $Root 'assets\miku\miku-reference.jpg'
$ChatDarkPath = Join-Path $Root 'assets\miku\chat-character-dark-v1.jpg'
$ChatLightPath = Join-Path $Root 'assets\miku\chat-character-light-v1.jpg'
$HomeDarkPath = Join-Path $Root 'assets\miku\home-scene-dark-v1.jpg'
$HomeLightPath = Join-Path $Root 'assets\miku\home-scene-light-v1.jpg'
$RunningSpritePath = Join-Path $Root 'assets\miku\task-running-chibi-centered-v6.webp'
$RunningStaticPath = Join-Path $Root 'assets\miku\task-running-sprite-chibi-v2.png'
$PreferredPort = 9345

function Get-WorkBuddyExecutable {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy\WorkBuddy.exe')
  )
  $uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($entry in Get-ItemProperty $uninstallRoots -ErrorAction SilentlyContinue) {
    if ($entry.DisplayName -eq 'WorkBuddy' -and $entry.InstallLocation) {
      $candidates += (Join-Path $entry.InstallLocation 'WorkBuddy.exe')
    }
  }
  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    $item = Get-Item -LiteralPath $candidate
    if ($item.VersionInfo.ProductName -eq 'WorkBuddy' -or $item.Name -eq 'WorkBuddy.exe') {
      return $item.FullName
    }
  }
  throw '没有找到 WorkBuddy。请先安装并至少启动一次 WorkBuddy。'
}

function Get-NodeRuntime {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { $command = Get-Command node -ErrorAction SilentlyContinue }
  if ($command) {
    $version = & $command.Source -p 'process.versions.node' 2>$null
    if ($LASTEXITCODE -eq 0 -and $version -and [int](($version -split '\.')[0]) -ge 22) {
      return $command.Source
    }
  }

  $exe = Get-WorkBuddyExecutable
  $nodeZip = Join-Path (Split-Path -Parent $exe) 'resources\vendor\node.zip'
  if (-not (Test-Path -LiteralPath $nodeZip)) {
    throw '未找到 Node.js 22，也无法读取 WorkBuddy 自带的 Node 运行时。'
  }
  $runtimeRoot = Join-Path $StateRoot 'runtime'
  $runtimeNode = Join-Path $runtimeRoot 'node.exe'
  if (-not (Test-Path -LiteralPath $runtimeNode)) {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($nodeZip)
    try {
      $entry = $archive.Entries | Where-Object { $_.FullName -match '^node-v[^/]+-win-x64/node\.exe$' } | Select-Object -First 1
      if (-not $entry) { throw 'WorkBuddy 自带的 Node 运行时格式不受支持。' }
      $temporaryNode = Join-Path $runtimeRoot 'node.exe.partial'
      if (Test-Path -LiteralPath $temporaryNode) { Remove-Item -LiteralPath $temporaryNode -Force }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $temporaryNode, $true)
      Move-Item -LiteralPath $temporaryNode -Destination $runtimeNode -Force
    } finally {
      $archive.Dispose()
    }
  }
  $runtimeVersion = & $runtimeNode -p 'process.versions.node' 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $runtimeVersion -or [int](($runtimeVersion -split '\.')[0]) -lt 22) {
    throw 'WorkBuddy 自带的 Node 运行时校验失败。'
  }
  return $runtimeNode
}

function Test-PortAvailable([int]$Port) {
  return -not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Select-WorkBuddyPort {
  for ($port = $PreferredPort; $port -le ($PreferredPort + 50); $port++) {
    if (Test-PortAvailable $port) { return $port }
  }
  throw '9345-9395 端口范围内没有可用端口。'
}

function Wait-Cdp([int]$Port, [int]$TimeoutSeconds = 25) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2 -MaximumRedirection 0
      if (@($targets | Where-Object { $_.type -eq 'page' -and "$($_.url) $($_.title)" -match 'WorkBuddy' }).Count -gt 0) {
        return $true
      }
    } catch {}
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Read-State {
  if (-not (Test-Path -LiteralPath $StatePath)) { return $null }
  try { return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

function Write-State([object]$State) {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  $json = $State | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($StatePath, $json, [System.Text.UTF8Encoding]::new($false))
}

function Stop-SavedInjector {
  $state = Read-State
  if (-not $state -or -not $state.injectorPid) { return }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$state.injectorPid)" -ErrorAction SilentlyContinue
  if (-not $process) { return }
  $expected = [System.IO.Path]::GetFullPath($InjectorPath)
  if ($process.Name -match '^node(\.exe)?$' -and $process.CommandLine -and $process.CommandLine.Contains($expected)) {
    Stop-Process -Id ([int]$state.injectorPid) -Force -ErrorAction SilentlyContinue
  }
}

function Stop-WorkBuddyGracefully([int]$TimeoutSeconds = 12) {
  $processes = @(Get-Process WorkBuddy -ErrorAction SilentlyContinue)
  if (-not $processes.Count) { return }
  foreach ($process in $processes) {
    if ($process.MainWindowHandle -ne 0) { [void]$process.CloseMainWindow() }
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 250
    $remaining = @(Get-Process WorkBuddy -ErrorAction SilentlyContinue)
  } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)
  if ($remaining.Count -gt 0) { $remaining | Stop-Process -Force }
}

function Apply-Skin {
  $exe = Get-WorkBuddyExecutable
  $node = Get-NodeRuntime
  foreach ($required in @($InjectorPath, $CssPath, $HeroPath, $ChatDarkPath, $ChatLightPath, $HomeDarkPath, $HomeLightPath, $RunningSpritePath, $RunningStaticPath)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "缺少皮肤文件：$required" }
  }
  $running = @(Get-Process WorkBuddy -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0 -and -not $RestartExisting) {
    throw 'WorkBuddy 正在运行。请关闭后重试，或允许工具自动重启。'
  }
  Stop-SavedInjector
  if ($running.Count -gt 0) { Stop-WorkBuddyGracefully }
  $port = Select-WorkBuddyPort
  Start-Process -FilePath $exe -ArgumentList @(
    '--remote-debugging-address=127.0.0.1',
    "--remote-debugging-port=$port"
  ) | Out-Null
  if (-not (Wait-Cdp -Port $port)) { throw "WorkBuddy 调试端口 $port 未就绪。" }
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  $stdout = Join-Path $StateRoot 'injector.log'
  $stderr = Join-Path $StateRoot 'injector-error.log'
  $injector = Start-Process -FilePath $node -ArgumentList @(
    $InjectorPath, '--watch', '--port', "$port", '--css', $CssPath, '--hero', $HeroPath,
    '--chat-dark', $ChatDarkPath, '--chat-light', $ChatLightPath,
    '--home-dark', $HomeDarkPath, '--home-light', $HomeLightPath,
    '--running-sprite', $RunningSpritePath, '--running-static', $RunningStaticPath
  ) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Write-State ([pscustomobject]@{
    schemaVersion = 1
    theme = 'miku-v1'
    port = $port
    injectorPid = $injector.Id
    workBuddyExe = $exe
    appliedAt = (Get-Date).ToString('o')
  })
  $verified = $false
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    Start-Sleep -Milliseconds 700
    & $node $InjectorPath --verify --port "$port" --css $CssPath --hero $HeroPath --chat-dark $ChatDarkPath --chat-light $ChatLightPath --home-dark $HomeDarkPath --home-light $HomeLightPath --running-sprite $RunningSpritePath --running-static $RunningStaticPath
    if ($LASTEXITCODE -eq 0) {
      $verified = $true
      break
    }
  }
  if (-not $verified) { throw '皮肤注入后的校验失败。' }
  return "初音未来皮肤已启用（端口 $port）。"
}

function Restore-Skin {
  $exe = Get-WorkBuddyExecutable
  $node = Get-NodeRuntime
  $state = Read-State
  if ($state -and $state.port) {
    try {
      & $node $InjectorPath --remove --port "$([int]$state.port)"
    } catch {}
  }
  Stop-SavedInjector
  Stop-WorkBuddyGracefully
  if (Test-Path -LiteralPath $StatePath) { Remove-Item -LiteralPath $StatePath -Force }
  Start-Process -FilePath $exe | Out-Null
  return '已恢复 WorkBuddy 原始界面并正常启动。'
}

function Get-SkinStatus {
  $state = Read-State
  if (-not $state) { return '未启用皮肤。' }
  $injector = Get-Process -Id ([int]$state.injectorPid) -ErrorAction SilentlyContinue
  if (-not $injector) { return '发现皮肤状态记录，但注入服务未运行。可重新应用皮肤。' }
  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$([int]$state.port)/json/list" -TimeoutSec 2
    if (@($targets).Count -gt 0) { return "初音未来皮肤正在运行（端口 $($state.port)）。" }
  } catch {}
  return '注入服务存在，但 WorkBuddy 未连接。可重新应用皮肤。'
}

function Verify-Skin {
  $state = Read-State
  if (-not $state -or -not $state.port) { throw '皮肤尚未启用。' }
  $node = Get-NodeRuntime
  $arguments = @(
    $InjectorPath, '--verify', '--port', "$([int]$state.port)", '--css', $CssPath, '--hero', $HeroPath,
    '--chat-dark', $ChatDarkPath, '--chat-light', $ChatLightPath,
    '--home-dark', $HomeDarkPath, '--home-light', $HomeLightPath,
    '--running-sprite', $RunningSpritePath, '--running-static', $RunningStaticPath
  )
  if ($ScreenshotPath) { $arguments += @('--screenshot', [System.IO.Path]::GetFullPath($ScreenshotPath)) }
  & $node @arguments
  if ($LASTEXITCODE -ne 0) { throw '皮肤校验失败。' }
  return '皮肤结构与关键控件校验通过。'
}

switch ($Action) {
  'Apply' { Apply-Skin }
  'Restore' { Restore-Skin }
  'Status' { Get-SkinStatus }
  'Verify' { Verify-Skin }
}
