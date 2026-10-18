<#
  Golden POS - one-time installer for an always-on Windows POS terminal
  ----------------------------------------------------------------------
  Run from an ELEVATED PowerShell (Run as administrator):

     powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1 -PaymentPrinter "XP-80C" -KitchenPrinter "XP-80 Kitchen"

  What it does
    1. Copies the POS to C:\GoldenPOS (keeps an existing database untouched).
    2. Installs dependencies and builds the fast production UI.
    3. Registers Windows scheduled task "GoldenPOS Server" that starts the POS
       at BOOT (before anyone logs in) and restarts it if it ever stops.
    4. Adds a Startup entry that opens the POS full-screen (kiosk) with
       silent printing as soon as the cashier's Windows account logs in.
    5. Opens port 3000 on the Private network only (waiter tablets on Wi-Fi).
    6. Stops the PC from sleeping, disables USB power-saving (printers/drawer
       stay awake), disables Fast Startup and sets Windows Update active hours.
    7. Optionally sets the payment printer as the Windows default printer
       (used only if the browser fallback ever prints).

  Re-run the same command from a NEW version's folder to update: code is
  replaced, backend\data (database, backups, bill logs) is preserved.

  Options
    -InstallDir      default C:\GoldenPOS
    -PaymentPrinter  Windows name of the receipt / cash-drawer printer
    -KitchenPrinter  Windows name of the KOT printer
    -RunAs           System (default: starts at boot) | User (starts at logon)
    -NoKiosk         don't add the full-screen browser to Startup
    -BackupDir       extra folder (other drive / USB) to mirror daily backups
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\GoldenPOS',
  [string]$PaymentPrinter = '',
  [string]$KitchenPrinter = '',
  [ValidateSet('System', 'User')][string]$RunAs = 'System',
  [switch]$NoKiosk,
  [string]$BackupDir = ''
)

$ErrorActionPreference = 'Stop'
$TaskName = 'GoldenPOS Server'
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Yellow }
function Ok($m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    !!  $m" -ForegroundColor Magenta }

# -- 0. Pre-flight -----------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Please run this script from PowerShell opened with "Run as administrator".'
}
$SourceDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js not found. Install Node.js 22 LTS (or newer) from https://nodejs.org (choose "for all users"), then re-run.' }
$ver = (& $node -v).TrimStart('v'); $parts = $ver.Split('.')
if ([int]$parts[0] -lt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -lt 5)) { throw "Node $ver is too old. Golden POS needs Node 22.5 or newer." }
$npm = Join-Path (Split-Path $node) 'npm.cmd'
Ok "Node $ver at $node"
if ($node -like "$env:USERPROFILE*" -and $RunAs -eq 'System') { Warn 'Node is installed inside your user profile. If the server does not start at boot, reinstall Node "for all users" or re-run with -RunAs User.' }

# -- 1. Copy to the install folder (data preserved) --------------
Step "Installing to $InstallDir"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$InstallDir*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Ok 'Stopped the running POS for the update'
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
if ($SourceDir.TrimEnd('\') -ne (Resolve-Path $InstallDir).Path.TrimEnd('\')) {
  $srcData = Join-Path $SourceDir 'backend\data'
  robocopy $SourceDir $InstallDir /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 /XD node_modules .next logs $srcData | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "File copy failed (robocopy code $LASTEXITCODE)" }
  $dstDb = Join-Path $InstallDir 'backend\data\pos.db'
  if (-not (Test-Path $dstDb) -and (Test-Path (Join-Path $srcData 'pos.db'))) {
    robocopy $srcData (Join-Path $InstallDir 'backend\data') /E /NFL /NDL /NJH /NJS /NP | Out-Null
    Ok 'Copied your existing database (first install)'
  } elseif (Test-Path $dstDb) { Ok 'Existing database kept' }
  Ok "Code copied from $SourceDir"
}

# -- 2. Dependencies + production build --------------------------
Step 'Installing dependencies (first time can take a few minutes)'
Push-Location $InstallDir
try {
  & $npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Check free disk space (need ~2 GB) and internet, then re-run.' }
  Ok 'Dependencies installed'
  Step 'Building the production UI'
  $env:NEXT_TELEMETRY_DISABLED = '1'; $env:BACKEND_URL = 'http://localhost:3001'; $env:NODE_OPTIONS = '--max-old-space-size=2048'
  Push-Location (Join-Path $InstallDir 'web')
  & $node 'node_modules\next\dist\bin\next' build
  $buildCode = $LASTEXITCODE
  Pop-Location
  if ($buildCode -ne 0) { throw 'UI build failed - see the messages above.' }
  Ok 'Production build ready'
} finally { Pop-Location }

# -- 3. Scheduled task: start at boot, restart forever -----------
Step "Registering '$TaskName' ($RunAs)"
$envLine = ''
if ($BackupDir) { $envLine = "set POS_BACKUP_DIR=$BackupDir&& " }
$launcher = Join-Path $InstallDir 'deploy\windows\run-server.cmd'
@"
@echo off
rem Auto-generated by install.ps1 - starts Golden POS (supervisor keeps it alive)
cd /d "$InstallDir"
$envLine"$node" "$InstallDir\start.js" >> "$InstallDir\logs\service.log" 2>&1
"@ | Set-Content -Path $launcher -Encoding ASCII
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$launcher`"" -WorkingDirectory $InstallDir
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
if ($RunAs -eq 'System') {
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Description 'Golden POS backend, UI and printer agent (auto-restart).' -Force | Out-Null
Ok 'Task registered'

# -- 4. Kiosk browser at logon -----------------------------------
if (-not $NoKiosk) {
  Step 'Adding full-screen POS to Startup'
  $startup = [Environment]::GetFolderPath('Startup')
  $lnkPath = Join-Path $startup 'Golden POS.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = 'powershell.exe'
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\deploy\windows\kiosk.ps1`""
  $lnk.WorkingDirectory = $InstallDir
  $lnk.WindowStyle = 7
  $lnk.Save()
  # Desktop "Golden POS" icon: double-click to open (starts the POS if needed)
  $desk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Golden POS.lnk'))
  $desk.TargetPath = 'powershell.exe'
  $desk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\deploy\windows\open-pos.ps1`" -FullScreen"
  $desk.WorkingDirectory = $InstallDir; $desk.WindowStyle = 7
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chrome) { $desk.IconLocation = "$chrome,0" }
  $desk.Save()
  Ok "Startup shortcut: $lnkPath"
}

# Desktop shortcut to the control panel (runs as administrator)
$ctl = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Golden POS Control.lnk'))
$ctl.TargetPath = Join-Path $InstallDir 'deploy\windows\pos-control.cmd'
$ctl.WorkingDirectory = $InstallDir
$ctl.Save()
$bytes = [IO.File]::ReadAllBytes($ctl.FullName); $bytes[0x15] = $bytes[0x15] -bor 0x20; [IO.File]::WriteAllBytes($ctl.FullName, $bytes)  # "Run as administrator"
Ok 'Desktop shortcut: Golden POS Control'

# -- 5. Firewall: UI on Private network only ---------------------
Step 'Firewall'
Get-NetFirewallRule -DisplayName 'Golden POS (3000)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Golden POS (3000)' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private | Out-Null
Ok 'Port 3000 allowed on Private networks (set your Wi-Fi to "Private")'

# -- 6. Power / reliability settings -----------------------------
Step 'Power and reliability'
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change monitor-timeout-ac 0 | Out-Null
powercfg /hibernate off | Out-Null    # also disables Fast Startup -> clean boot, printers re-detected
# USB selective suspend OFF (printers + cash drawer never "fall asleep")
powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 | Out-Null
powercfg /setactive SCHEME_CURRENT | Out-Null
# Windows Update must not restart the till during service hours (06:00-23:59)
$wu = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
New-Item -Path $wu -Force | Out-Null
Set-ItemProperty -Path $wu -Name ActiveHoursStart -Value 6 -Type DWord
Set-ItemProperty -Path $wu -Name ActiveHoursEnd -Value 23 -Type DWord
# Stop Windows from silently switching the default printer
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows' -Name LegacyDefaultPrinterMode -Value 1 -Type DWord
Ok 'Never sleep, USB power-saving off, Fast Startup off, active hours 06-23'

# -- 7. Printers -------------------------------------------------
Step 'Printers'
$installed = @(Get-Printer | Select-Object -ExpandProperty Name)
Write-Host ('    Installed: ' + ($installed -join ' | '))
if ($PaymentPrinter) {
  if ($installed -contains $PaymentPrinter) {
    (Get-CimInstance Win32_Printer -Filter ("Name='" + $PaymentPrinter.Replace("'", "''") + "'")) | Invoke-CimMethod -MethodName SetDefaultPrinter | Out-Null
    Ok "Default printer -> $PaymentPrinter"
  } else { Warn "Payment printer '$PaymentPrinter' not found. Use one of the names above." }
}
if ($KitchenPrinter -and -not ($installed -contains $KitchenPrinter)) { Warn "Kitchen printer '$KitchenPrinter' not found." }

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

# -- 8. Start now + health check ---------------------------------
Step 'Starting Golden POS'
Start-ScheduledTask -TaskName $TaskName
$up = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  if (Test-PosUp) { $up = $true; break }
}
if ($up) { Ok 'POS is running -> http://localhost:3000' } else { Warn "POS did not answer yet. Check $InstallDir\logs\launcher.log" }
try {
  $p = Invoke-RestMethod -Proxy $null -TimeoutSec 15 'http://127.0.0.1:9110/printers'
  Ok ('Print agent sees: ' + ($p.printers -join ' | '))
} catch { Warn 'Print agent not answering yet - check logs\agent.log' }

if ($PaymentPrinter -or $KitchenPrinter) {
  Write-Host "    Next: log in as Admin > Settings > Printer management > tick 'Enable direct thermal printing',"
  Write-Host "          kitchen = '$KitchenPrinter', payment = '$PaymentPrinter', Save, then Test both."
}

Write-Host "`nDone. Restart the PC once to confirm everything comes back by itself." -ForegroundColor Cyan
Write-Host "Data:   $InstallDir\backend\data   (pos.db, backups\, print-log\)"
Write-Host "Logs:   $InstallDir\logs"
Write-Host "Manage: 'Golden POS Control' on the desktop`n"
