<#
.SYNOPSIS
  Publishes the locally-running API through a Cloudflare quick tunnel and points
  the Vercel dashboard at it.

.DESCRIPTION
  A quick tunnel gets a NEW random hostname every time it starts. Two things
  depend on that hostname and both must be updated together, or the dashboard
  breaks in a way that looks like a backend outage:

    1. Vercel's NEXT_PUBLIC_API_BASE_URL. This is inlined into the client bundle
       at BUILD time, so changing the variable is not enough -- the site has to
       be redeployed or the old URL stays compiled into the shipped JavaScript.
    2. The API's APP_BASE_URL CORS allowlist, which must contain the Vercel
       origin. That one is stable, so it only needs setting once.

  This script starts the tunnel, waits for the hostname, updates Vercel, and
  redeploys. Run it after every reboot, or any time the tunnel drops.

.NOTES
  Prerequisites: the API must already be listening on :4000, and `vercel` must
  be logged in. Leave this window open -- closing it kills the tunnel.
#>

param(
  [int]    $ApiPort     = 4000,
  [string] $VercelOrigin = "https://lead-gen-dashboard-umber.vercel.app"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

if (-not (Test-Path $cloudflared)) {
  throw "cloudflared not found at $cloudflared. Install with: winget install --id Cloudflare.cloudflared"
}

# Fail fast with a clear message rather than tunnelling to a dead port and
# leaving the user to debug a 502 from Cloudflare.
try {
  Invoke-WebRequest -Uri "http://localhost:$ApiPort/api/v1/health" -TimeoutSec 10 -UseBasicParsing | Out-Null
  Write-Host "API on :$ApiPort is healthy" -ForegroundColor Green
} catch {
  throw "No healthy API on :$ApiPort. Start it first:  npm run dev:api"
}

# A quick tunnel whose control stream has failed keeps the process alive,
# retrying forever, while its hostname serves nothing. That looks identical to
# "the tunnel is running" from the outside, so always start from a clean slate
# rather than trusting an existing process.
$existing = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Stopping existing cloudflared (PID $($existing.Id -join ', '))..." -ForegroundColor Yellow
  $existing | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

Write-Host "Starting Cloudflare quick tunnel..." -ForegroundColor Cyan
$log = Join-Path $repoRoot "cloudflared.err.log"
Remove-Item $log -ErrorAction SilentlyContinue

# --protocol http2 is NOT optional here.
#
# cloudflared defaults to QUIC (UDP/7844). On this network that connection dies
# within minutes and the log fills with "control stream encountered a failure
# while serving" followed by endless reconnects — the process stays alive while
# the hostname serves nothing, so from outside it looks identical to a working
# tunnel. HTTP/2 runs over TCP/443 and is stable.
Start-Process -FilePath $cloudflared `
  -ArgumentList "tunnel","--protocol","http2","--url","http://localhost:$ApiPort" `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $repoRoot "cloudflared.log") `
  -RedirectStandardError $log

# cloudflared prints the assigned hostname to stderr a few seconds after start.
$tunnelUrl = $null
foreach ($i in 1..30) {
  Start-Sleep -Seconds 2
  if (Test-Path $log) {
    $match = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
             Select-Object -First 1
    if ($match) { $tunnelUrl = $match.Matches[0].Value; break }
  }
}
if (-not $tunnelUrl) { throw "Tunnel did not report a hostname within 60s. Check $log" }

Write-Host "Tunnel is up: $tunnelUrl" -ForegroundColor Green
$apiBase = "$tunnelUrl/api/v1"

try {
  Invoke-WebRequest -Uri "$apiBase/health" -TimeoutSec 30 -UseBasicParsing | Out-Null
  Write-Host "API reachable through the tunnel" -ForegroundColor Green
} catch {
  throw "Tunnel is up but the API is not reachable through it: $_"
}

Write-Host "Updating Vercel NEXT_PUBLIC_API_BASE_URL..." -ForegroundColor Cyan
Push-Location $repoRoot
try {
  # `vercel env add` reads the value from stdin. Piping a PowerShell string
  # into a native executable (`$apiBase | vercel env add ...`) does NOT feed it
  # stdin the way the CLI expects -- the command just blocks forever waiting
  # for input, with no output, which is indistinguishable from a slow network.
  # Redirecting stdin from a real file is the reliable way to do it here.
  $stdinFile = Join-Path $env:TEMP "vercel-env-value.txt"
  # -NoNewline matters: a trailing newline becomes part of the stored value,
  # producing a URL the browser silently fails to call.
  [System.IO.File]::WriteAllText($stdinFile, $apiBase)
  try {
    foreach ($target in @("production","preview")) {
      $p = Start-Process -FilePath "vercel.cmd" `
        -ArgumentList "env","add","NEXT_PUBLIC_API_BASE_URL",$target,"--force" `
        -RedirectStandardInput $stdinFile `
        -NoNewWindow -Wait -PassThru
      if ($p.ExitCode -ne 0) { throw "vercel env add failed for $target (exit $($p.ExitCode))" }
      Write-Host "  $target updated" -ForegroundColor Green
    }
  } finally {
    Remove-Item $stdinFile -ErrorAction SilentlyContinue
  }
  # Required, not optional: NEXT_PUBLIC_* is compiled in, so without this the
  # live site keeps calling the previous tunnel hostname.
  Write-Host "Redeploying so the new URL is compiled in..." -ForegroundColor Cyan
  vercel --prod --yes 2>&1 | Select-String "Aliased|Production" | Select-Object -First 2
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Dashboard : $VercelOrigin"
Write-Host "  API       : $apiBase"
Write-Host ""
Write-Host "Keep this tunnel running. Closing it takes the dashboard's backend offline." -ForegroundColor Yellow
Write-Host "If APP_BASE_URL in .env does not include $VercelOrigin, the browser will" -ForegroundColor Yellow
Write-Host "block requests with a CORS error -- set it and restart the API." -ForegroundColor Yellow
