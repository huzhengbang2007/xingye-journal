param([Parameter(Mandatory=$true)][string]$Destination, [Parameter(Mandatory=$true)][string]$Jdk)
$ErrorActionPreference = 'Stop'
$directory = Join-Path (Split-Path -Parent $PSScriptRoot) '.signing'
$identity = Get-Content -LiteralPath (Join-Path $directory 'identity.json') -Raw | ConvertFrom-Json
if (Test-Path -LiteralPath $Destination) { throw 'Choose a new empty backup directory; existing backups are never overwritten.' }
$password = Read-Host 'Choose a strong offline backup password (keep it separately)' -AsSecureString
if ($password.Length -lt 16) { throw 'Use at least 16 characters.' }
[IO.Directory]::CreateDirectory([IO.Path]::GetFullPath($Destination)) | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.SetAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $Destination -AclObject $acl
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$($identity.windowsThumbprint)"
Export-PfxCertificate -Cert $certificate -FilePath (Join-Path $Destination 'hoshino-team-windows.pfx') -Password $password | Out-Null
$androidBackup = Join-Path $Destination 'hoshino-team-android.p12'
Copy-Item -LiteralPath (Join-Path $directory 'hoshino-team-android.p12') -Destination $androidBackup
$current = (Get-Content -LiteralPath (Join-Path $directory 'password.dpapi') -Raw).Trim() | ConvertTo-SecureString
$oldPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($current)
$newPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
    $env:HOSHINO_OLD_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($oldPointer)
    $env:HOSHINO_NEW_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($newPointer)
    & (Join-Path $Jdk 'bin\keytool.exe') -storepasswd -keystore $androidBackup -storepass:env HOSHINO_OLD_PASSWORD -new:env HOSHINO_NEW_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Re-encrypting the Android backup failed; do not rely on this incomplete backup.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($oldPointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($newPointer)
    Remove-Item Env:HOSHINO_OLD_PASSWORD,Env:HOSHINO_NEW_PASSWORD -ErrorAction SilentlyContinue
}
Copy-Item -LiteralPath (Join-Path $directory 'identity.json') -Destination $Destination
Write-Host 'Encrypted signing-key backup exported. Keep the password separately. No plaintext password was saved.'
