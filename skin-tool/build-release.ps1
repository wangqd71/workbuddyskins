[CmdletBinding()]
param([string]$Version = '1.8.2')

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ReleaseRoot = Join-Path $Root '发布包'
$PackageName = "WorkBuddy初音换肤工具-v$Version"
$Staging = Join-Path $ReleaseRoot $PackageName
$ZipPath = Join-Path $ReleaseRoot "$PackageName.zip"
$ChecksumPath = Join-Path $ReleaseRoot "$PackageName.sha256.txt"

function Assert-WithinRelease([string]$Path) {
  $releasePrefix = [System.IO.Path]::GetFullPath($ReleaseRoot).TrimEnd('\') + '\'
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝操作发布目录以外的路径：$resolved"
  }
}

New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null
foreach ($target in @($Staging, $ZipPath, $ChecksumPath)) {
  Assert-WithinRelease $target
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}

foreach ($directory in @(
  $Staging,
  (Join-Path $Staging 'assets\miku'),
  (Join-Path $Staging 'scripts')
)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$files = @{
  '打开换肤工具.cmd' = '打开换肤工具.cmd'
  'skin-manager.ps1' = 'skin-manager.ps1'
  'README.md' = 'README.md'
  '使用说明.txt' = '使用说明.txt'
  '版本信息.txt' = '版本信息.txt'
  '素材与许可说明.txt' = '素材与许可说明.txt'
  'WorkBuddy初音换肤工具_使用手册_v1.2.docx' = 'WorkBuddy初音换肤工具_使用手册_v1.2.docx'
  'assets\miku\theme.css' = 'assets\miku\theme.css'
  'assets\miku\miku-reference.jpg' = 'assets\miku\miku-reference.jpg'
  'assets\miku\chat-character-dark-v1.jpg' = 'assets\miku\chat-character-dark-v1.jpg'
  'assets\miku\chat-character-light-v1.jpg' = 'assets\miku\chat-character-light-v1.jpg'
  'assets\miku\home-scene-dark-v1.jpg' = 'assets\miku\home-scene-dark-v1.jpg'
  'assets\miku\home-scene-light-v1.jpg' = 'assets\miku\home-scene-light-v1.jpg'
  'assets\miku\task-running-sprite-chibi-v2.png' = 'assets\miku\task-running-sprite-chibi-v2.png'
  'assets\miku\task-running-chibi-centered-v6.webp' = 'assets\miku\task-running-chibi-centered-v6.webp'
  'scripts\injector.mjs' = 'scripts\injector.mjs'
  'scripts\workbuddy-skin.ps1' = 'scripts\workbuddy-skin.ps1'
}

foreach ($relative in $files.Keys) {
  $source = Join-Path $Root $relative
  $destination = Join-Path $Staging $files[$relative]
  if (-not (Test-Path -LiteralPath $source)) { throw "缺少发布文件：$source" }
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

Compress-Archive -LiteralPath $Staging -DestinationPath $ZipPath -CompressionLevel Optimal
$hash = Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256
"SHA256  $($hash.Hash)`r`nFILE    $($hash.Path | Split-Path -Leaf)" | Set-Content -LiteralPath $ChecksumPath -Encoding UTF8

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
} finally {
  $archive.Dispose()
}
foreach ($forbidden in @('workbuddy-miku-preview.png', 'build_user_guide.py', '_raw.docx', 'workbuddy-dom.json', 'task-running-sprite-source-v1.png', 'task-running-miku-vibe.gif')) {
  if ($entries -match [regex]::Escape($forbidden)) { throw "发布包包含禁止文件：$forbidden" }
}
foreach ($required in @(
  '打开换肤工具.cmd',
  '素材与许可说明.txt',
  '使用手册_v1.2.docx',
  'scripts/injector.mjs',
  'assets/miku/theme.css',
  'assets/miku/chat-character-dark-v1.jpg',
  'assets/miku/chat-character-light-v1.jpg',
  'assets/miku/home-scene-dark-v1.jpg',
  'assets/miku/home-scene-light-v1.jpg',
  'assets/miku/task-running-sprite-chibi-v2.png'
  'assets/miku/task-running-chibi-centered-v6.webp'
)) {
  if (-not ($entries -match [regex]::Escape($required))) { throw "发布包缺少文件：$required" }
}

Write-Host "发布包：$ZipPath"
Write-Host "校验码：$ChecksumPath"
