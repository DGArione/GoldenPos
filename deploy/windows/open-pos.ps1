<#
  Golden POS - "just open it" launcher for non-technical users.
  Started by OPEN-POS.cmd (or the "Golden POS" desktop icon).

  1. If the POS is already running -> opens it straight away.
  2. If not -> starts it in the background (first time: installs and
     prepares it automatically) while showing a "please wait" window.
  3. Opens the POS in its own window with silent printing.
  4. Puts a "Golden POS" icon on the desktop for next time.
  No admin rights, no typing, no black windows.
#>
param([switch]$FullScreen)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$Url = 'http://localhost:3000/login'
$here = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# Prefer the installed copy (C:\GoldenPOS) if there is one - it holds the real data.
$root = $here
if ((Test-Path 'C:\GoldenPOS\start.js') -and (Test-Path 'C:\GoldenPOS\web\node_modules')) { $root = 'C:\GoldenPOS' }
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

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

$openLog = Join-Path $logs 'open-pos.log'
function Log($t) { try { Add-Content -Path $openLog -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $t) } catch {} }
Log "---- open-pos started (root: $root)"

function Find-Browser {
  @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Open-Pos {
  $browser = Find-Browser
  if (-not $browser) { Start-Process $Url; return }
  $profileDir = Join-Path $env:LOCALAPPDATA 'GoldenPOS\app-profile'
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  $a = @("--user-data-dir=`"$profileDir`"", '--kiosk-printing', '--no-first-run', '--no-default-browser-check',
         '--disable-session-crashed-bubble', '--disable-features=Translate,TranslateUI')
  if ($FullScreen) { $a += @('--kiosk', $Url) } else { $a += @("--app=$Url", '--start-maximized') }
  Start-Process -FilePath $browser -ArgumentList $a
}

function Add-DesktopIcon {
  try {
    $lnkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Golden POS.lnk'
    if (Test-Path $lnkPath) { return }
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut($lnkPath)
    $lnk.TargetPath = 'powershell.exe'
    $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $lnk.WorkingDirectory = $root
    $lnk.WindowStyle = 7
    $b = Find-Browser
    if ($b) { $lnk.IconLocation = "$b,0" } else { $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,43" }
    $lnk.Description = 'Open Golden POS'
    $lnk.Save()
  } catch {}
}

function Show-Problem($text, $logFile) {
  $r = [System.Windows.Forms.MessageBox]::Show(
    $text + "`r`n`r`nPress OK to open the details for your technician, or Cancel to close.",
    'Golden POS', 'OKCancel', 'Warning')
  if ($r -eq 'OK' -and $logFile -and (Test-Path $logFile)) { Start-Process notepad.exe $logFile }
}

# -- Already running? Just open it. -----------------------------
if (Test-PosUp) { Open-Pos; Add-DesktopIcon; exit 0 }

# -- Node.js present? -------------------------------------------
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node -and (Test-Path "$env:ProgramFiles\nodejs\node.exe")) { $node = "$env:ProgramFiles\nodejs\node.exe" }
if (-not $node) {
  $r = [System.Windows.Forms.MessageBox]::Show(
    "Golden POS needs one free program called Node.js.`r`n`r`nPress OK to open the download page. Choose the 'LTS' version, install it with all the default options, then double-click Golden POS again.",
    'Golden POS - one-time setup', 'OKCancel', 'Information')
  if ($r -eq 'OK') { Start-Process 'https://nodejs.org/en/download' }
  exit 1
}
$npm = Join-Path (Split-Path $node) 'npm.cmd'

# -- "Please wait" window ---------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Golden POS'
$form.Size = New-Object System.Drawing.Size(460, 210)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false; $form.MinimizeBox = $false
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::White
$title = New-Object System.Windows.Forms.Label
$title.Text = 'Opening Golden POS...'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(246, 153, 13)
$title.AutoSize = $true; $title.Location = New-Object System.Drawing.Point(24, 22)
$msg = New-Object System.Windows.Forms.Label
$msg.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$msg.Size = New-Object System.Drawing.Size(400, 46); $msg.Location = New-Object System.Drawing.Point(26, 64)
$msg.Text = 'Starting up. Please wait.'
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Style = 'Marquee'; $bar.MarqueeAnimationSpeed = 30
$bar.Size = New-Object System.Drawing.Size(400, 16); $bar.Location = New-Object System.Drawing.Point(26, 120)
$form.Controls.AddRange(@($title, $msg, $bar))
$form.Show(); [System.Windows.Forms.Application]::DoEvents()

function Wait-Step([int]$seconds) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
}
function Say($t) { $msg.Text = $t; [System.Windows.Forms.Application]::DoEvents() }

# -- First time: install the parts ------------------------------
if (-not (Test-Path (Join-Path $root 'web\node_modules\next'))) {
  Say "First-time setup: downloading the parts it needs.`r`nThis needs internet and takes about 5-10 minutes. Only once."
  $installLog = Join-Path $logs 'first-setup.log'
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c `"`"$npm`" install --no-audit --no-fund > `"$installLog`" 2>&1`"" -WorkingDirectory $root -WindowStyle Hidden -PassThru
  while (-not $p.HasExited) { Wait-Step 1 }
  if ($p.ExitCode -ne 0 -or -not (Test-Path (Join-Path $root 'web\node_modules\next'))) {
    $form.Close()
    Show-Problem "First-time setup could not finish. Check the internet connection and that there is at least 2 GB free on drive C:, then try again." $installLog
    exit 1
  }
}

# -- Start the POS in the background ----------------------------
Say 'Starting the POS...'
$started = $false
if (Get-ScheduledTask -TaskName 'GoldenPOS Server' -ErrorAction SilentlyContinue) {
  Start-ScheduledTask -TaskName 'GoldenPOS Server' -ErrorAction SilentlyContinue
  Wait-Step 8
  if (Test-PosUp) { $started = $true }
}
$proc = $null
if (-not $started) {
  Log "starting $node start.js"
  $proc = Start-Process -FilePath $node -ArgumentList "`"$root\start.js`"" -WorkingDirectory $root -WindowStyle Hidden -PassThru
}

# -- Wait until it answers (first start also prepares the screens) -
$t0 = Get-Date
$firstBuild = -not (Test-Path (Join-Path $root 'web\.next\BUILD_ID'))
while (-not (Test-PosUp)) {
  $secs = [int]((Get-Date) - $t0).TotalSeconds
  if ($firstBuild) { Say "Preparing the screens for the first time ($secs s).`r`nThis takes 1-3 minutes, only once." }
  else { Say "Starting the POS... ($secs s)" }
  # The launcher stopped by itself: either another copy is already running
  # (then the next check succeeds) or it failed - don't make people wait.
  if ($proc -and $proc.HasExited -and -not (Test-PosUp)) {
    # Exit code 3 = another launcher is already starting the POS: just keep waiting.
    if ($proc.ExitCode -eq 3) { Log 'another launcher is already starting the POS - waiting'; $proc = $null; Wait-Step 1; continue }
    Wait-Step 3
    if (Test-PosUp) { break }
    Log "start.js exited with code $($proc.ExitCode)"
    $form.Close()
    Show-Problem 'The POS could not start. Restart the computer and try again. If it still does not open, call your technician.' (Get-ChildItem -Path $logs -Filter 'launcher*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName)
    exit 1
  }
  $limit = 120; if ($firstBuild) { $limit = 600 }
  if ($secs -gt $limit) {
    Log "gave up after $secs s"
    $form.Close()
    Show-Problem 'The POS did not start. Restart the computer and try again. If it still does not open, call your technician.' (Get-ChildItem -Path $logs -Filter 'launcher*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName)
    exit 1
  }
  Wait-Step 2
}

Log "POS answered - opening"
Say 'Ready! Opening...'
Open-Pos
Add-DesktopIcon
Wait-Step 2
$form.Close()
exit 0
