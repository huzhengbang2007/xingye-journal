param([string]$Sdk = $env:ANDROID_HOME, [string]$Jdk = $env:JAVA_HOME, [string]$Gradle, [string]$IdentityDirectory = $env:HOSHINO_SIGNING_DIRECTORY, [switch]$Debug)
$ErrorActionPreference = 'Stop'
if (-not $Sdk -or -not (Test-Path -LiteralPath (Join-Path $Sdk 'platforms\android-36\android.jar'))) { throw 'Provide an Android SDK containing platform 36.' }
if (-not $Jdk -or -not (Test-Path -LiteralPath (Join-Path $Jdk 'bin\java.exe'))) { throw 'Provide a JDK 17 or newer.' }
$projectDirectory = Split-Path -Parent $PSScriptRoot
$sourceStatus = @(& git -C $projectDirectory status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine source status.' }
$sourceDirty = [bool]$sourceStatus.Count
if (-not $Debug -and $sourceDirty) { throw 'Release requires committed clean source, including untracked files.' }
if (-not $Debug -and -not $env:XINGYE_KEYSTORE) {
  if (-not $IdentityDirectory) { $IdentityDirectory = Join-Path $projectDirectory '.signing' }
  $identity = Get-Content -LiteralPath (Join-Path $IdentityDirectory 'identity.json') -Raw | ConvertFrom-Json
  $protectedPassword = (Get-Content -LiteralPath (Join-Path $IdentityDirectory 'password.dpapi') -Raw).Trim() | ConvertTo-SecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($protectedPassword)
  try { $env:XINGYE_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $env:XINGYE_KEY_PASSWORD = $env:XINGYE_STORE_PASSWORD
  $env:XINGYE_KEYSTORE = Join-Path $IdentityDirectory 'hoshino-team-android.p12'
  $env:XINGYE_KEY_ALIAS = $identity.androidAlias
  $temporarySigningEnvironment = $true
}
if (-not $Debug -and (-not $env:XINGYE_STORE_PASSWORD -or -not $env:XINGYE_KEY_ALIAS -or -not $env:XINGYE_KEY_PASSWORD)) { throw 'Complete release signing credentials are required.' }
$androidDirectory = Join-Path $projectDirectory 'android-companion'
if (-not $Gradle) { $Gradle = Join-Path $androidDirectory 'gradlew.bat' }
$env:JAVA_HOME = $Jdk
$env:ANDROID_HOME = $Sdk
[System.IO.File]::WriteAllText((Join-Path $androidDirectory 'local.properties'), 'sdk.dir=' + $Sdk.Replace('\','/').Replace(':','\:') + "`n")
$version = (Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw | ConvertFrom-Json).version
$buildId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$variant = if ($Debug) { 'debug' } else { 'release' }
$signingDirectory = Join-Path $androidDirectory '.signing'
New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
$debugKey = Join-Path $signingDirectory 'debug.keystore'
if ($Debug -and -not (Test-Path -LiteralPath $debugKey)) {
  & (Join-Path $Jdk 'bin\keytool.exe') -genkeypair -keystore $debugKey -storepass android -keypass android -alias androiddebugkey -dname 'CN=Android Debug,O=Xingye Journal,C=CN' -keyalg RSA -keysize 2048 -validity 10000
  if ($LASTEXITCODE -ne 0) { throw 'Debug key generation failed.' }
}
Push-Location -LiteralPath $androidDirectory
try { & $Gradle --no-daemon "assemble$variant" "lint$variant"; if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' } } finally {
  Pop-Location
  if ($temporarySigningEnvironment) { foreach ($name in @('XINGYE_KEYSTORE','XINGYE_STORE_PASSWORD','XINGYE_KEY_ALIAS','XINGYE_KEY_PASSWORD')) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue } }
}
$outputRoot = if ($Debug) { 'artifacts\android-debug' } else { "releases\$version" }
$releaseDirectory = Join-Path $projectDirectory "$outputRoot\android-$buildId"
if (Test-Path -LiteralPath $releaseDirectory) { throw 'Build output exists.' }
New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
$targetPath = Join-Path $releaseDirectory "xingyeji-$version-$variant.apk"
Copy-Item -LiteralPath (Join-Path $androidDirectory "app\build\outputs\apk\$variant\app-$variant.apk") -Destination $targetPath
$buildTools = Join-Path $Sdk 'build-tools\35.0.0'
$signature = @(& (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $targetPath)
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$badging = @(& (Join-Path $buildTools 'aapt2.exe') dump badging $targetPath)
if ($LASTEXITCODE -ne 0) { throw 'APK manifest inspection failed.' }
if (-not $Debug -and (($badging -match 'application-debuggable') -or ($signature -match 'CN=Android Debug'))) { throw 'Debuggable or debug-signed APK cannot be published.' }
if (-not $Debug -and -not ($signature -match 'CN=HOSHINO TEAM(?:,|$)')) { throw 'Release APK publisher must be HOSHINO TEAM.' }
$linkage = @(& (Join-Path $Jdk 'bin\java.exe') (Join-Path $androidDirectory 'checks\ApkLinkageCheck.java') $targetPath)
if ($LASTEXITCODE -ne 0) { throw 'APK has missing scanner runtime dependencies; release rejected.' }
[IO.File]::WriteAllLines((Join-Path $releaseDirectory 'APK-LINKAGE.txt'), $linkage)
[IO.File]::WriteAllLines((Join-Path $releaseDirectory 'APK-VERIFICATION.txt'), @($signature) + @($badging))
$lintReport = Join-Path $androidDirectory "app\build\reports\lint-results-$variant.html"
if (-not (Test-Path -LiteralPath $lintReport)) { throw 'Missing lint report.' }
Copy-Item -LiteralPath $lintReport -Destination $releaseDirectory
$digest = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($targetPath + '.sha256', "$digest  $([IO.Path]::GetFileName($targetPath))`n")
$hashes = @{}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apkArchive = [IO.Compression.ZipFile]::OpenRead($targetPath)
try {
  foreach ($entry in $apkArchive.Entries) {
    if ($entry.FullName.StartsWith('assets/www/') -and $entry.Name) {
      $stream = $entry.Open()
      $sha = [Security.Cryptography.SHA256]::Create()
      try { $hashes[$entry.FullName] = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose(); $stream.Dispose() }
    }
  }
} finally { $apkArchive.Dispose() }
@{version=$version; publisher='HOSHINO TEAM'; variant=$variant; buildId=$buildId; commit=((& git -C $projectDirectory rev-parse HEAD) -join ''); sourceDirty=$sourceDirty; sourceStatus=$sourceStatus; apkSha256=$digest; signature=$signature; hashes=$hashes} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releaseDirectory 'BUILD-INFO.json') -Encoding UTF8
if (-not $Debug) { & (Join-Path $PSScriptRoot 'sign-release.ps1') -Manifest (Join-Path $releaseDirectory 'BUILD-INFO.json') -IdentityDirectory $IdentityDirectory }
Write-Host "Created: $targetPath"
