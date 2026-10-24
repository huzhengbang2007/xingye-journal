param([string]$File, [string]$Manifest, [string]$IdentityDirectory = $env:HOSHINO_SIGNING_DIRECTORY)
$ErrorActionPreference = 'Stop'
if (-not $IdentityDirectory) { $IdentityDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) '.signing' }
$identity = Get-Content -LiteralPath (Join-Path $IdentityDirectory 'identity.json') -Raw | ConvertFrom-Json
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$($identity.windowsThumbprint)"
if ($certificate.Subject -notmatch 'CN=HOSHINO TEAM(?:,|$)' -or -not $certificate.HasPrivateKey) { throw 'HOSHINO TEAM signing certificate unavailable.' }
if ($File) {
  $result = Set-AuthenticodeSignature -LiteralPath $File -Certificate $certificate -HashAlgorithm SHA256 -IncludeChain Signer
  $verified = Get-AuthenticodeSignature -LiteralPath $File
  if ($verified.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or $verified.Status -in @('NotSigned','HashMismatch','NotSupportedFileFormat')) { throw "Authenticode signing failed: $($verified.Status)" }
  Write-Host "Signed: $([IO.Path]::GetFileName($File)); publisher HOSHINO TEAM; Windows trust: $($verified.Status)"
}
if ($Manifest) {
  $rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
  try { $signature = $rsa.SignData([IO.File]::ReadAllBytes($Manifest), [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1) } finally { $rsa.Dispose() }
  [IO.File]::WriteAllText($Manifest + '.sig', [Convert]::ToBase64String($signature), [Text.Encoding]::ASCII)
  Write-Host "Signed manifest: $([IO.Path]::GetFileName($Manifest))"
}
