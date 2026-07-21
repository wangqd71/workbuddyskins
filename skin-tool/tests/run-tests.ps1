$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scripts = @(
  (Join-Path $root 'skin-manager.ps1'),
  (Join-Path $root 'scripts\workbuddy-skin.ps1')
)

foreach ($script in $scripts) {
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) { throw "PowerShell parse failed: $script`n$($errors | Out-String)" }
}

$injector = Join-Path $root 'scripts\injector.mjs'
& node --check $injector
if ($LASTEXITCODE -ne 0) { throw 'Node syntax check failed.' }

$css = Get-Content -LiteralPath (Join-Path $root 'assets\miku\theme.css') -Raw -Encoding UTF8
foreach ($marker in @(
  'data-workbuddy-skin="miku-v1"',
  'data-workbuddy-color-mode="light"',
  '.conversation-list',
  '.wb-home-page',
  '.wb-home-composer',
  '.project-grid__card',
  '.ec-expert-card',
  '.atm-row',
  '.settings-modal',
  '.daily-checkin',
  '.collapsible-section-header',
  '--wb-miku-chat-dark',
  '--wb-miku-chat-light',
  '--wb-miku-home-dark',
  '--wb-miku-home-light',
  '--wb-miku-running-sprite',
  '.workbuddy-miku-running-character',
  'data-workbuddy-task-running="true"',
  '--wb-miku-running-static',
  '.workspace-preparing__icon',
  'MIKU DANCE // CONNECTING',
  '@keyframes wb-miku-stage-pulse',
  '[class*="_topRightSlotStandalone_"]',
  'img[src*="BuddyCats"]',
  '.main-content--chat > .chat-container',
  '.main-content--welcome',
  '[class*="_container_pf4c4_"]',
  '.sidebar-next[data-view="artifacts"]',
  '.sc-editor',
  '.sc-block-simple_table_cell'
)) {
  if (-not $css.Contains($marker)) { throw "Missing CSS marker: $marker" }
}

$injectorSource = Get-Content -LiteralPath $injector -Raw -Encoding UTF8
foreach ($marker in @(
  'applyDocument',
  'document.querySelectorAll(''iframe'')',
  'frame.contentDocument',
  'workbuddy-miku-color-mode',
  'event.isTrusted',
  '--chat-dark',
  '--chat-light',
  '--home-dark',
  '--home-light',
  '--running-sprite',
  'workbuddyTaskRunning',
  'avatar-fold-status',
  'M13 10C11.3431',
  'aria-busy="true"',
  'attributeFilter:'
)) {
  if (-not $injectorSource.Contains($marker)) { throw "Missing full-page injector marker: $marker" }
}

$runningSprite = Join-Path $root 'assets\miku\task-running-chibi-centered-v6.webp'
if (-not (Test-Path -LiteralPath $runningSprite)) { throw "Missing smooth task-running animation: $runningSprite" }
$webpBytes = [System.IO.File]::ReadAllBytes($runningSprite)
if ($webpBytes.Length -lt 16 -or [Text.Encoding]::ASCII.GetString($webpBytes, 0, 4) -ne 'RIFF' -or [Text.Encoding]::ASCII.GetString($webpBytes, 8, 4) -ne 'WEBP') {
  throw 'Task-running animation is not a valid WebP file.'
}
$runningStatic = Join-Path $root 'assets\miku\task-running-sprite-chibi-v2.png'
if (-not (Test-Path -LiteralPath $runningStatic)) { throw "Missing reduced-motion static sprite: $runningStatic" }

$controller = Get-Content -LiteralPath (Join-Path $root 'scripts\workbuddy-skin.ps1') -Raw -Encoding UTF8
foreach ($forbidden in @('app.asar"', 'app.asar\''', 'Set-Content $exe', 'Copy-Item $exe')) {
  if ($controller.Contains($forbidden)) { throw "Controller contains a forbidden installed-app mutation pattern: $forbidden" }
}
foreach ($required in @('resources\vendor\node.zip', 'System.IO.Compression.ZipFileExtensions', "Join-Path `$runtimeRoot 'node.exe'")) {
  if (-not $controller.Contains($required)) { throw "Missing portable runtime fallback marker: $required" }
}

Write-Host 'PASS: PowerShell, injector syntax, theme selectors, and non-invasive controller checks.'
