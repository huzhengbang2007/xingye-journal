param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$identityNewDirectory = -not (Test-Path -LiteralPath $Directory)
if ($identityNewDirectory) { [IO.Directory]::CreateDirectory($Directory) | Out-Null }
$identityCurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if ($identityNewDirectory) {
    $identityAcl = New-Object System.Security.AccessControl.DirectorySecurity
    $identityAcl.SetAccessRuleProtection($true, $false)
    $identityAcl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identityCurrentUser.User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    Set-Acl -LiteralPath $Directory -AclObject $identityAcl
} else {
    $identityAcl = Get-Acl -LiteralPath $Directory
    if (-not $identityAcl.AreAccessRulesProtected) { throw 'Device identity directory permissions are not protected.' }
    foreach ($identityRule in $identityAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        if ($identityRule.AccessControlType -eq 'Allow' -and $identityRule.IdentityReference.Value -ne $identityCurrentUser.User.Value) { throw 'Device identity directory has unexpected access permissions.' }
    }
}

$identityBundle = Join-Path $Directory 'identity.json'
$identityPfx = Join-Path $Directory 'identity.pfx'
$identityPassword = Join-Path $Directory 'password.dpapi'
if (-not (Test-Path -LiteralPath $identityBundle)) {
    if ((Test-Path -LiteralPath $identityPfx) -or (Test-Path -LiteralPath $identityPassword)) {
        if (-not ((Test-Path -LiteralPath $identityPfx) -and (Test-Path -LiteralPath $identityPassword))) { throw 'Incomplete legacy identity. Restore its original files; existing trust must not be silently replaced.' }
        $bundle = @{pfx=[Convert]::ToBase64String([IO.File]::ReadAllBytes($identityPfx)); password=(Get-Content -LiteralPath $identityPassword -Raw).Trim()}
    } else {
        $identityRandom = New-Object byte[] 48
        $identityRng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $identityRng.GetBytes($identityRandom) } finally { $identityRng.Dispose() }
        $identitySecure = ConvertTo-SecureString ([Convert]::ToBase64String($identityRandom)) -AsPlainText -Force
        $identityCert = New-SelfSignedCertificate -Subject 'CN=HOSHINO TEAM Device Sync, O=HOSHINO TEAM' -FriendlyName 'HOSHINO TEAM Device Sync' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyExportPolicy Exportable -KeyLength 3072 -HashAlgorithm SHA256 -NotBefore (Get-Date).AddMinutes(-5) -NotAfter (Get-Date).AddYears(5) -TextExtension @('2.5.29.17={text}DNS=xingye.local', '2.5.29.19={critical}{text}CA=false')
        $identityBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($identitySecure)
        try {
            $identitySecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($identityBstr)
            $bundle = @{pfx=[Convert]::ToBase64String($identityCert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $identitySecret)); password=(ConvertFrom-SecureString $identitySecure)}
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($identityBstr)
            Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $identityCert.Thumbprint)
            $identitySecret = $null
        }
    }
    $temporary = Join-Path $Directory ('identity-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporary, ($bundle | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)
    Move-Item -LiteralPath $temporary -Destination $identityBundle
}
$bundle = Get-Content -LiteralPath $identityBundle -Raw | ConvertFrom-Json
$identitySecure = $bundle.password | ConvertTo-SecureString
$identityBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($identitySecure)
try {
    $identitySecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($identityBstr)
    $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2
    $certificate.Import([Convert]::FromBase64String($bundle.pfx), $identitySecret, [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $fingerprint = [BitConverter]::ToString($sha.ComputeHash($certificate.RawData)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose(); $certificate.Dispose() }
    @{passphrase=$identitySecret; fingerprint=$fingerprint} | ConvertTo-Json -Compress
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($identityBstr); $identitySecret=$null }
