param([Parameter(Mandatory=$true)][string]$Jdk)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$directory = Join-Path $project '.signing'
$metadata = Join-Path $directory 'identity.json'
if (Test-Path -LiteralPath $metadata) { Write-Host 'Existing HOSHINO TEAM identity retained.'; exit 0 }
if (Test-Path -LiteralPath $directory) { throw 'Signing directory already exists without complete metadata; inspect it before creating an identity.' }
[IO.Directory]::CreateDirectory($directory) | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.SetAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $directory -AclObject $acl
$random = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$secret = [Convert]::ToBase64String($random)
$secure = ConvertTo-SecureString $secret -AsPlainText -Force
ConvertFrom-SecureString $secure | Set-Content -LiteralPath (Join-Path $directory 'password.dpapi')
$certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=HOSHINO TEAM, O=HOSHINO TEAM' -FriendlyName 'HOSHINO TEAM Release Signing' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotBefore (Get-Date).AddDays(-1) -NotAfter (Get-Date).AddYears(10)
Export-PfxCertificate -Cert $certificate -FilePath (Join-Path $directory 'hoshino-team-windows.pfx') -Password $secure | Out-Null
Export-Certificate -Cert $certificate -FilePath (Join-Path $project 'scripts\packaging\HOSHINO-TEAM.cer') | Out-Null
$env:HOSHINO_SIGNING_PASSWORD = $secret
try {
  & (Join-Path $Jdk 'bin\keytool.exe') -genkeypair -keystore (Join-Path $directory 'hoshino-team-android.p12') -storetype PKCS12 -storepass:env HOSHINO_SIGNING_PASSWORD -keypass:env HOSHINO_SIGNING_PASSWORD -alias hoshino-team -dname 'CN=HOSHINO TEAM,O=HOSHINO TEAM' -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000
  if ($LASTEXITCODE -ne 0) { throw 'Android release identity creation failed.' }
} finally { Remove-Item Env:HOSHINO_SIGNING_PASSWORD; $secret = $null }
$rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($certificate)
try { $parameters = $rsa.ExportParameters($false) } finally { $rsa.Dispose() }
$sha = [Security.Cryptography.SHA256]::Create()
try { $certificateDigest = [BitConverter]::ToString($sha.ComputeHash($certificate.RawData)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
@{publisher='HOSHINO TEAM'; algorithm='RSA-SHA256'; modulus=[Convert]::ToBase64String($parameters.Modulus); exponent=[Convert]::ToBase64String($parameters.Exponent); certificateSha256=$certificateDigest; certificateSubject=$certificate.Subject; trust='self-signed'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $project 'scripts\packaging\publisher.json') -Encoding UTF8
@{publisher='HOSHINO TEAM'; windowsThumbprint=$certificate.Thumbprint; androidAlias='hoshino-team'; certificateSha256=$certificateDigest; createdAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $metadata -Encoding UTF8
Write-Host "Created HOSHINO TEAM release identities. Public certificate SHA256: $certificateDigest"
Write-Host 'Private keys and DPAPI-protected password are in .signing. No trust-store changes were made.'
