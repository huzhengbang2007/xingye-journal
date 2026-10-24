param([Parameter(Mandatory=$true)][string]$Address)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location -LiteralPath $projectDirectory
$parsedAddress = [System.Net.IPAddress]::Parse($Address)
if ($parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Use the computer IPv4 address.' }
if (-not (Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $Address)) { throw 'This address does not belong to this computer.' }
$certificateDirectory = Join-Path $projectDirectory 'certs'
if (Test-Path -LiteralPath (Join-Path $certificateDirectory 'daylight.pfx')) { throw 'Certificate already exists. Back it up before replacing it.' }
New-Item -ItemType Directory -Path $certificateDirectory -Force | Out-Null
$taskIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = Get-Acl -LiteralPath $certificateDirectory
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($taskIdentity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $certificateDirectory -AclObject $acl
$secret = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$secureSecret = ConvertTo-SecureString $secret -AsPlainText -Force
$certificate = New-SelfSignedCertificate -Subject 'CN=Daylight Local' -FriendlyName 'Daylight Local HTTPS' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyExportPolicy Exportable -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(1) -TextExtension @("2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1&IPAddress=$Address", '2.5.29.19={critical}{text}CA=true')
Export-PfxCertificate -Cert $certificate -FilePath (Join-Path $certificateDirectory 'daylight.pfx') -Password $secureSecret | Out-Null
Export-Certificate -Cert $certificate -FilePath (Join-Path $certificateDirectory 'daylight.cer') | Out-Null
ConvertFrom-SecureString $secureSecret | Set-Content -LiteralPath (Join-Path $certificateDirectory 'pfx-password.dpapi')
[System.IO.File]::WriteAllText((Join-Path $certificateDirectory 'address.txt'), $Address)
Write-Host "Certificate created for https://${Address}:3210"
Write-Host "SHA256 fingerprint: $([Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($certificate.RawData)))"
Write-Host 'Install certs/daylight.cer as a trusted certificate on your own devices before signing in.'
Write-Host 'Do NOT copy daylight.pfx or pfx-password.dpapi to other devices.'
Write-Host 'Run scripts/development/legacy-https/start-https.ps1 after trusting the certificate.'
Write-Host 'No firewall rules have been changed.'
