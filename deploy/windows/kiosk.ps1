<#
  Golden POS - full-screen kiosk browser (started at logon by install.ps1)
  * Waits until the POS server answers, then opens it full-screen.
  * --kiosk-printing: any browser print goes straight to the Windows default
    printer with NO dialog and NO "Save as PDF" prompt.
  * Separate browser profile: no "Restore pages?" / sign-in / tab bubbles.
  * If the browser is closed or crashes it re-opens by itself.
    To leave kiosk mode for maintenance run deploy\windows\exit-kiosk.cmd
    (or press Ctrl+Alt+Del > Task Manager).
#>
$ErrorActionPreference = 'SilentlyContinue'
$Url = 'http://localhost:3000/login'
$stateDir = Join-Path $env:LOCALAPPDATA 'GoldenPOS'
$profileDir = Join-Path $stateDir 'kiosk-profile'
$stopFlag = Join-Path $stateDir 'kiosk.stop'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
Remove-Item $stopFlag -Force -ErrorAction SilentlyContinue

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { exit 1 }

$browserArgs = @(
  "--user-data-dir=`"$profileDir`"",
  '--kiosk', '--kiosk-printing',
  '--no-first-run', '--no-default-browser-check',
  '--disable-session-crashed-bubble', '--noerrdialogs', '--disable-infobars',
  '--disable-features=Translate,TranslateUI,HardwareMediaKeyHandling',
  '--disable-pinch', '--overscroll-history-navigation=0',
  '--autoplay-policy=no-user-gesture-required',
  '--check-for-update-interval=31536000'
)
if ($browser -like '*msedge.exe') { $browserArgs += '--edge-kiosk-type=fullscreen' }

# Mark the last session as clean so the browser never offers "Restore pages".
$prefs = Join-Path $profileDir 'Default\Preferences'
function Set-CleanExit {
  if (Test-Path $prefs) {
    try {
      $raw = [IO.File]::ReadAllText($prefs)
      $raw = $raw -replace '"exit_type":"Crashed"', '"exit_type":"Normal"' -replace '"exited_cleanly":false', '"exited_cleanly":true'
      [IO.File]::WriteAllText($prefs, $raw, (New-Object Text.UTF8Encoding($false)))
    } catch {}
  }
}

function Test-PosUp {
  # Ask the POS directly on 127.0.0.1 - no proxy, no IPv6 detour, so the
  # answer is always right on office / corporate PCs too.
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect('127.0.0.1', 3000, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(1500)) { return $false }
    $c.EndConnect($iar)
    $s = $c.GetStream(); $s.ReadTimeout = 5000; $s.WriteTimeout = 2000
    $req = [Text.Encoding]::ASCII.GetBytes("GET /login HTTP/1.0`r`nHost: localhost`r`nConnection: close`r`n`r`n")
    $s.Write($req, 0, $req.Length)
    $buf = New-Object byte[] 64
    $n = $s.Read($buf, 0, 64)
    $line = [Text.Encoding]::ASCII.GetString($buf, 0, $n)
    return ($line -match '^HTTP/1\.[01] (200|30\d)')
  } catch { return $false } finally { $c.Close() }
}

function Wait-ForServer {
  for ($i = 0; $i -lt 180; $i++) {   # up to ~6 minutes after boot
    if (Test-PosUp) { return }
    Start-Sleep -Seconds 2
  }
}

while (-not (Test-Path $stopFlag)) {
  Wait-ForServer
  Set-CleanExit
  $p = Start-Process -FilePath $browser -ArgumentList ($browserArgs + $Url) -PassThru
  $p.WaitForExit()
  if (Test-Path $stopFlag) { break }
  Start-Sleep -Seconds 3
}
Remove-Item $stopFlag -Force -ErrorAction SilentlyContinue
