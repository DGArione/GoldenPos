# Golden POS - remove auto-start (run as administrator). Your data is NOT deleted.
$ErrorActionPreference = 'SilentlyContinue'
Stop-ScheduledTask -TaskName 'GoldenPOS Server'
Unregister-ScheduledTask -TaskName 'GoldenPOS Server' -Confirm:$false
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*GoldenPOS*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'Golden POS.lnk') -Force
Get-NetFirewallRule -DisplayName 'Golden POS (3000)' | Remove-NetFirewallRule
Write-Host 'Auto-start removed. The POS folder and backend\data were left in place.'
