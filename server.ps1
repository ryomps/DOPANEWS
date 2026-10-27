# DOPANEWS Local Web Server, Mureka API Proxy & News URL Extractor (PowerShell)
$port = 8080
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " 🔥 DOPANEWS Server Started: http://localhost:$port" -ForegroundColor Green
Write-Host " - Mureka API Proxy: /api/mureka/*" -ForegroundColor Yellow
Write-Host " - News URL Extractor: /api/fetch-url?url=..." -ForegroundColor Yellow
Write-Host " 終了するにはこのウィンドウを閉じるか Ctrl+C を押してください" -ForegroundColor Gray
Write-Host "=====================================================" -ForegroundColor Cyan

Start-Process "http://localhost:$port"

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".mp3"  = "audio/mpeg"
  ".wav"  = "audio/wav"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".svg"  = "image/svg+xml"
}

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    $path = $req.Url.LocalPath

    # CORS headers
    $res.AddHeader("Access-Control-Allow-Origin", "*")
    $res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $res.AddHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")

    if ($req.HttpMethod -eq "OPTIONS") {
      $res.StatusCode = 204
      $res.Close()
      continue
    }

    # 1. News URL Fetch Proxy (/api/fetch-url?url=...)
    if ($path -eq "/api/fetch-url") {
      $targetUrl = $req.QueryString["url"]
      try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $webClient = New-Object System.Net.WebClient
        $webClient.Encoding = [System.Text.Encoding]::UTF8
        $webClient.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        $htmlContent = $webClient.DownloadString($targetUrl)

        $payload = @{
          ok = $true
          url = $targetUrl
          html = $htmlContent
        } | ConvertTo-Json -Compress -Depth 4

        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $res.StatusCode = 200
        $res.ContentType = "application/json; charset=utf-8"
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } catch {
        $errJson = (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
        $res.StatusCode = 500
        $res.ContentType = "application/json; charset=utf-8"
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
      $res.Close()
      continue
    }

    # 2. Proxy /api/mureka/* -> https://api.mureka.ai/*
    if ($path.StartsWith("/api/mureka/")) {
      $targetSubPath = $path.Substring("/api/mureka".Length)
      $targetUrl = "https://api.mureka.ai$targetSubPath"
      $authHeader = $req.Headers["Authorization"]

      try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $headers = @{ "Authorization" = $authHeader }

        if ($req.HttpMethod -eq "POST") {
          $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
          $bodyText = $reader.ReadToEnd()
          $reader.Close()

          $apiRes = Invoke-WebRequest -Uri $targetUrl -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($bodyText)) -UseBasicParsing
        } else {
          $apiRes = Invoke-WebRequest -Uri $targetUrl -Method Get -Headers $headers -UseBasicParsing
        }

        $res.StatusCode = [int]$apiRes.StatusCode
        $res.ContentType = "application/json; charset=utf-8"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($apiRes.Content)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } catch {
        $res.StatusCode = 500
        $errMsg = $_.Exception.Message
        if ($_.Exception.Response) {
          $errStream = $_.Exception.Response.GetResponseStream()
          $errReader = New-Object System.IO.StreamReader($errStream)
          $errMsg = $errReader.ReadToEnd()
        }
        $errJson = (@{ error = $errMsg } | ConvertTo-Json -Compress)
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
        $res.ContentType = "application/json; charset=utf-8"
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
      $res.Close()
      continue
    }

    # 3. Static file serving
    if ($path -eq "/") { $path = "/index.html" }
    $filePath = Join-Path $root ($path.TrimStart('/').Replace('/', '\'))

    if (Test-Path $filePath -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
      $res.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $res.StatusCode = 200
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
    $res.Close()
  } catch {
    # Ignore listener interruption on exit
  }
}
