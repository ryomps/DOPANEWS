param([int]$Port = 8080, [switch]$NoBrowser, [string]$DataDirectory = '')
$ErrorActionPreference = 'Stop'

# 1. Prefer Node.js (server.cjs) when available
$nodeCandidates = @()
$cmdNode = Get-Command node -ErrorAction SilentlyContinue
if ($cmdNode) { $nodeCandidates += $cmdNode.Source }
$nodeCandidates += @(
  "$env:ProgramFiles\nodejs\node.exe",
  "${env:ProgramFiles(x86)}\nodejs\node.exe",
  "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
)
$nodeExe = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($nodeExe) {
  $serverArgs = @((Join-Path $PSScriptRoot 'server.cjs'), '--port', "$Port")
  if ($NoBrowser) { $serverArgs += '--no-browser' }
  if ($DataDirectory) { $serverArgs += @('--data-directory', $DataDirectory) }
  & $nodeExe @serverArgs
  exit $LASTEXITCODE
}

# 2. Fallback to built-in PowerShell HttpListener when Node.js is not installed
$root = $PSScriptRoot
$configPath = Join-Path $root 'config.local.json'
$libraryDir = if ($DataDirectory) { [System.IO.Path]::GetFullPath($DataDirectory) } else { Join-Path $root '.local\library' }
if (-not (Test-Path $libraryDir)) { New-Item -ItemType Directory -Path $libraryDir -Force | Out-Null }

function Read-LocalConfig {
  $cfg = @{ gemini = $env:GEMINI_API_KEY; mureka = $env:MUREKA_API_KEY }
  if (Test-Path $configPath) {
    try {
      $raw = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($raw.GeminiApiKey) { $cfg.gemini = $raw.GeminiApiKey }
      if ($raw.MurekaApiKey) { $cfg.mureka = $raw.MurekaApiKey }
    } catch {}
  }
  return $cfg
}

function Send-Json($res, $obj, [int]$status = 200) {
  $res.StatusCode = $status
  $res.ContentType = 'application/json; charset=utf-8'
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 12 -Compress))
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.OutputStream.Close()
}

$listener = New-Object System.Net.HttpListener
$urlPrefix = "http://localhost:$Port/"
$listener.Prefixes.Add($urlPrefix)
$listener.Start()

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " DOPANEWS Local Server (PowerShell Mode): $urlPrefix" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan

if (-not $NoBrowser) {
  Start-Process $urlPrefix
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = $req.Url.AbsolutePath

    try {
      if ($path -eq '/api/config' -and $req.HttpMethod -eq 'GET') {
        $cfg = Read-LocalConfig
        Send-Json $res @{ geminiConfigured = [bool]$cfg.gemini; murekaConfigured = [bool]$cfg.mureka }
        continue
      }

      if ($path -eq '/api/config' -and $req.HttpMethod -eq 'POST') {
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $bodyObj = $reader.ReadToEnd() | ConvertFrom-Json
        $cur = Read-LocalConfig
        $nextGem = if ($bodyObj.GeminiApiKey) { $bodyObj.GeminiApiKey } else { $cur.gemini }
        $nextMur = if ($bodyObj.MurekaApiKey) { $bodyObj.MurekaApiKey } else { $cur.mureka }
        @{ GeminiApiKey = "$nextGem"; MurekaApiKey = "$nextMur" } | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8
        Send-Json $res @{ ok = $true; geminiConfigured = [bool]$nextGem; murekaConfigured = [bool]$nextMur }
        continue
      }

      if ($path -match '^/api/gemini/([a-zA-Z0-9.-]+)$' -and $req.HttpMethod -eq 'POST') {
        $model = $Matches[1]
        $cfg = Read-LocalConfig
        $gemKey = if ($req.Headers['x-goog-api-key']) { $req.Headers['x-goog-api-key'] } else { $cfg.gemini }
        if (-not $gemKey) { Send-Json $res @{ error = 'Gemini API Key is not configured.' } 400; continue }
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $reqBody = $reader.ReadToEnd()
        $targetUri = "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent"
        $upRes = Invoke-WebRequest -Uri $targetUri -Method POST -Headers @{ 'x-goog-api-key' = $gemKey } -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($reqBody)) -UseBasicParsing
        $res.StatusCode = [int]$upRes.StatusCode
        $res.ContentType = 'application/json; charset=utf-8'
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($upRes.Content)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
        continue
      }

      if ($path -match '^/api/mureka/v1/song/(generate|query/[a-zA-Z0-9_-]+)$') {
        $sub = $Matches[1]
        $cfg = Read-LocalConfig
        $authHeader = $req.Headers['Authorization']
        $murKey = if ($authHeader) { $authHeader -replace '^Bearer\s+', '' } else { $cfg.mureka }
        if (-not $murKey) { Send-Json $res @{ error = 'Mureka API Key is not configured.' } 400; continue }
        $targetUri = "https://api.mureka.ai/v1/song/$sub"
        $headers = @{ 'Authorization' = "Bearer $murKey" }
        if ($req.HttpMethod -eq 'POST') {
          $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
          $reqBody = $reader.ReadToEnd()
          $upRes = Invoke-WebRequest -Uri $targetUri -Method POST -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($reqBody)) -UseBasicParsing
        } else {
          $upRes = Invoke-WebRequest -Uri $targetUri -Method GET -Headers $headers -UseBasicParsing
        }
        $res.StatusCode = [int]$upRes.StatusCode
        $res.ContentType = 'application/json; charset=utf-8'
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($upRes.Content)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
        continue
      }

      if ($path -eq '/api/fetch-url' -and $req.HttpMethod -eq 'GET') {
        $targetUrl = $req.QueryString['url']
        $upRes = Invoke-WebRequest -Uri $targetUrl -Headers @{ 'User-Agent' = 'Mozilla/5.0' } -UseBasicParsing -TimeoutSec 25
        Send-Json $res @{ ok = $true; html = $upRes.Content }
        continue
      }

      if ($path -eq '/api/library' -and $req.HttpMethod -eq 'GET') {
        $items = @()
        Get-ChildItem -Path $libraryDir -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object {
          try { $items += (Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json) } catch {}
        }
        Send-Json $res @{ items = $items }
        continue
      }

      $relPath = if ($path -eq '/') { 'index.html' } else { $path.TrimStart('/') }
      $filePath = Join-Path $root $relPath
      if (Test-Path $filePath -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
        $mime = switch ($ext) {
          '.html' { 'text/html; charset=utf-8' }
          '.css'  { 'text/css; charset=utf-8' }
          '.js'   { 'application/javascript; charset=utf-8' }
          '.json' { 'application/json; charset=utf-8' }
          '.mp3'  { 'audio/mpeg' }
          default { 'application/octet-stream' }
        }
        $res.StatusCode = 200
        $res.ContentType = $mime
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
        continue
      }

      Send-Json $res @{ error = 'Not found' } 404
    } catch {
      try { Send-Json $res @{ error = $_.Exception.Message } 500 } catch {}
    }
  }
} finally {
  $listener.Stop()
}
