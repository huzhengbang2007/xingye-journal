$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location -LiteralPath $projectDirectory
$certificateDirectory = Join-Path $projectDirectory 'certs'
$env:TLS_PFX_PATH = Join-Path $certificateDirectory 'daylight.pfx'
$protectedPath = Join-Path $certificateDirectory 'pfx-password.dpapi'
if (-not (Test-Path -LiteralPath $protectedPath)) {
    $legacyPath = Join-Path $certificateDirectory 'pfx-password.txt'
    $legacySecret = ConvertTo-SecureString ([IO.File]::ReadAllText($legacyPath).Trim()) -AsPlainText -Force
    ConvertFrom-SecureString $legacySecret | Set-Content -LiteralPath $protectedPath
    Remove-Item -LiteralPath $legacyPath
}
$protectedSecret = (Get-Content -LiteralPath $protectedPath -Raw).Trim() | ConvertTo-SecureString
$env:TLS_PFX_PASSWORD = [Net.NetworkCredential]::new('', $protectedSecret).Password
$address = [System.IO.File]::ReadAllText((Join-Path $certificateDirectory 'address.txt')).Trim()
$parsedAddress = [System.Net.IPAddress]::Parse($address)
if ($parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or -not (Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $address)) { throw 'The certificate IP is not active on this computer. Reconfigure the intended private connection.' }
$env:HOST = $address
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$bundledNode = Join-Path $projectDirectory 'runtime\node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } elseif ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
Write-Host "Open https://${address}:3210 on your devices. Keep this window open."
try { & $nodePath (Join-Path $projectDirectory 'server.mjs') } finally { Remove-Item Env:TLS_PFX_PASSWORD -ErrorAction SilentlyContinue; Remove-Item Env:HOST -ErrorAction SilentlyContinue; Remove-Item Env:TLS_PFX_PATH -ErrorAction SilentlyContinue }
