$ErrorActionPreference = 'Stop'
Write-Host 'Xingye Journal - read-only connection check'
Write-Host 'Choose your own hotspot / USB tethering / Bluetooth PAN / Tailscale adapter.'
Write-Host 'Do not select the campus Wi-Fi IP if you want to keep the service off that network.'
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object {
  $taskAddress = $_.IPAddress
  $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
  [PSCustomObject]@{ Address = $taskAddress; Adapter = $_.InterfaceAlias; Description = $adapter.InterfaceDescription; NextStep = "pwsh -File .\scripts\development\legacy-https\setup-https.ps1 -Address $taskAddress" }
} | Format-List
Write-Host 'This script does not open ports, change networks, install software, or modify firewall rules.'
