param([int]$Port = 8080, [switch]$NoBrowser, [string]$DataDirectory = '')
$ErrorActionPreference = 'Stop'
$serverArgs = @((Join-Path $PSScriptRoot 'server.cjs'), '--port', "$Port")
if ($NoBrowser) { $serverArgs += '--no-browser' }
if ($DataDirectory) { $serverArgs += @('--data-directory', $DataDirectory) }
& node @serverArgs
exit $LASTEXITCODE
