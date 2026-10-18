<#
  Golden POS - let customers on MOBILE DATA order from the table QR.

  Publishes ONLY the customer gateway (127.0.0.1:3100: table menu + place
  order) to the internet through a secure tunnel. Staff screens, logins,
  reports and printers are never reachable from outside.
  No router changes, no port forwarding, works with any internet connection.

  Run as administrator (SETUP-ONLINE-ORDERING.cmd does this for you).
#>
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Tools = Join-Path $Root 'tools'
$Cf = Join-Path $Tools 'cloudflared.exe'
$GatewayUrl = 'http://127.0.0.1:3100'

function Title($t) { Write-Host "`n=== $t ===" -ForegroundColor Yellow }
function Ok($t) { Write-Host "  OK  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  !!  $t" -ForegroundColor Magenta }

function Test-Gateway {
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 3100); $c.Close(); return $true } catch { return $false }
}

function Get-Cloudflared {
  if (Test-Path $Cf) { return }
  New-Item -ItemType Directory -Force -Path $Tools | Out-Null
  Write-Host '  Downloading cloudflared (Cloudflare''s official tunnel program, ~60 MB)...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $Cf
  Ok "cloudflared saved to $Cf"
}

function Show-Next($url) {
  Write-Host ''
  Write-Host '  NEXT STEPS' -ForegroundColor Cyan
  Write-Host "  1. Open the POS > Settings > Online ordering & QR"
  Write-Host "  2. Put this in 'QR code address':  $url" -ForegroundColor White
  Write-Host "  3. Press Save changes, then Floor > Print all table QR cards"
  Write-Host "  4. Test: turn OFF Wi-Fi on your phone and scan a table card."
  try { Set-Clipboard -Value $url; Write-Host '  (The address is copied - just paste it.)' } catch {}
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this as administrator (use SETUP-ONLINE-ORDERING.cmd).' }

Title 'Golden POS - online ordering for customers on mobile data'
if (Test-Gateway) { Ok 'Customer gateway is running on this computer' }
else { Warn 'Customer gateway is not running. Start the POS first (Golden POS Control > 4), then run this again.'; Read-Host 'Press Enter to close'; exit 1 }

Write-Host @'

  Choose how to publish the table menu:

    1  Cloudflare Tunnel  - permanent address on YOUR domain, e.g. https://order.goldenbeach.lk
                            (free; needs a domain added to a free Cloudflare account)   [RECOMMENDED]
    2  Tailscale Funnel   - permanent address without buying a domain,
                            e.g. https://golden-pos.tail1234.ts.net   (free account)
    3  Quick test link    - temporary address to try it now (changes every time - do NOT print)
    4  Turn online ordering OFF (remove the tunnel)
'@
$choice = Read-Host '  Type 1, 2, 3 or 4'

switch ($choice) {
  '1' {
    Title 'Cloudflare Tunnel'
    Write-Host @'
  In a browser (any computer):
   a. Sign in at https://dash.cloudflare.com  (free account; your domain must be added there)
   b. Open  Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared
   c. Name it  golden-pos  > Save
   d. On "Install and run connector" choose Windows and COPY the long token
      (the text after  cloudflared.exe service install )
   e. Next > Public hostname:  Subdomain  order   Domain  your-domain
      Service  HTTP   URL  localhost:3100   > Save tunnel
'@
    $token = (Read-Host '  Paste the token here').Trim()
    if ($token -match 'service install\s+(\S+)') { $token = $Matches[1] }
    if ($token.Length -lt 50) { throw 'That does not look like a tunnel token. Copy the long text after "service install".' }
    Get-Cloudflared
    try { & $Cf service uninstall 2>$null | Out-Null } catch {}
    & $Cf service install $token
    Start-Sleep -Seconds 5
    $svc = Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') { Ok 'Tunnel service installed - it starts automatically with Windows' }
    else { Warn 'Service installed but not running yet - check the token, or restart the PC.' }
    do {
      $host1 = Read-Host '  Type the public address you set in step e (e.g. order.goldenbeach.live)'
      $host1 = "$host1".Trim() -replace '^https?://', '' -replace '/+$', ''
    } while ($host1 -notmatch '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
    Show-Next "https://$host1"
  }
  '2' {
    Title 'Tailscale Funnel'
    $ts = "$env:ProgramFiles\Tailscale\tailscale.exe"
    if (-not (Test-Path $ts)) {
      Warn 'Tailscale is not installed. The download page will open - install it, sign in, then run this again.'
      Start-Process 'https://tailscale.com/download/windows'
      Read-Host 'Press Enter to close'; exit 0
    }
    & $ts up | Out-Host
    Write-Host '  Turning on Funnel for the customer gateway (if a link appears, open it once to allow Funnel)...'
    & $ts funnel --bg 3100 | Out-Host
    $status = (& $ts funnel status) -join "`n"
    Write-Host $status
    $m = [regex]::Match($status, 'https://[^\s/]+')
    if ($m.Success) { Ok 'Funnel is on and stays on after restarts'; Show-Next $m.Value }
    else { Warn 'Could not read the address. Run  "tailscale funnel status"  to see it.' }
  }
  '3' {
    Title 'Quick test link (temporary)'
    Get-Cloudflared
    Write-Host '  Starting a temporary tunnel. Look for a line with  https://....trycloudflare.com'
    Write-Host '  Open it on a phone using MOBILE DATA, add /t/<code> from a table QR. Press Ctrl+C to stop.' -ForegroundColor Cyan
    & $Cf tunnel --no-autoupdate --url $GatewayUrl
  }
  '4' {
    Title 'Turning online ordering off'
    if (Test-Path $Cf) { try { & $Cf service uninstall | Out-Host; Ok 'Cloudflare tunnel removed' } catch { Warn $_.Exception.Message } }
    $ts = "$env:ProgramFiles\Tailscale\tailscale.exe"
    if (Test-Path $ts) { try { & $ts funnel reset | Out-Host; Ok 'Tailscale Funnel turned off' } catch {} }
    Write-Host '  Now set Settings > Online ordering & QR back to "Use this computer''s address" and reprint the cards.'
  }
  default { Warn 'Nothing chosen.' }
}
Write-Host ''
Read-Host 'Press Enter to close'
