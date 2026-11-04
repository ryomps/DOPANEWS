param([int]$Port = 8080, [switch]$NoBrowser, [string]$DataDirectory = '', [switch]$Lan)
$ErrorActionPreference = 'Stop'

# 1. Prefer Node.js (server.cjs) when available
$nodeCandidates = @()
$cmdNode = Get-Command node -ErrorAction SilentlyContinue
if ($cmdNode) { $nodeCandidates += $cmdNode.Source }
$nodeCandidates += @(
  "$env:ProgramFiles\nodejs\node.exe",
  "${env:ProgramFiles(x86)}\nodejs\node.exe",
  "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
  "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
$nodeExe = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($nodeExe) {
  $serverArgs = @((Join-Path $PSScriptRoot 'server.cjs'), '--port', "$Port")
  if ($Lan) { $serverArgs += '--lan' }
  if ($NoBrowser) { $serverArgs += '--no-browser' }
  if ($DataDirectory) { $serverArgs += @('--data-directory', $DataDirectory) }
  & $nodeExe @serverArgs
  exit $LASTEXITCODE
}

throw 'DOPANEWS requires Node.js 22 or later for AI review and saved music. Install Node.js, then run start_server.bat again.'
