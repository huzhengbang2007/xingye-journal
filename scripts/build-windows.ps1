param([string]$Node, [string]$NativeDirectory, [switch]$AllowDirtyReview)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$pin = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'packaging\node-runtime.json') -Raw | ConvertFrom-Json
if (-not $Node) { $Node = Join-Path $project ".tooling\node-$($pin.version)\node.exe" }
if (-not (Test-Path -LiteralPath $Node)) { throw "Download $($pin.url) to $Node before building. Expected SHA256: $($pin.sha256)" }
$runtimeHash = (Get-FileHash -LiteralPath $Node -Algorithm SHA256).Hash.ToLowerInvariant()
if ($runtimeHash -ne $pin.sha256) { throw 'Runtime is not the pinned official nodejs.org binary.' }
$runtimeInfo = (& $Node -p 'JSON.stringify({version:process.version,arch:process.arch})') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $runtimeInfo.arch -ne $pin.arch -or $runtimeInfo.version -ne $pin.version) { throw 'Pinned runtime version/architecture mismatch.' }
$sourceStatus = @(& git -C $project status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine source status.' }
$dirty = [bool]$sourceStatus.Count
if ($dirty -and -not $AllowDirtyReview) { throw 'Release requires a committed clean source tree, including untracked files. Use -AllowDirtyReview only for a review candidate.' }
$version = (Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version
$buildId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$releases = Join-Path $project "releases\$version\$buildId"
if (Test-Path -LiteralPath $releases) { throw 'Build output already exists.' }
New-Item -ItemType Directory -Path $releases | Out-Null
$work = Join-Path ([IO.Path]::GetTempPath()) ('xingye-package-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $work 'app'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
# An explicit allowlist excludes vaults, credentials, source tooling and unrelated workspace files.
foreach ($name in @('public','lib','examples','server.mjs','package.json','start.cmd','uninstall.cmd','README.md','LICENSE','NOTICE','THIRD-PARTY-NOTICES.md','CONNECTIONS.md','ARTWORK-PROMPTS.md',"RELEASE-$version.md")) {
    Copy-Item -LiteralPath (Join-Path $project $name) -Destination $stage -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
foreach ($name in @('desktop-launcher.mjs','device-identity.ps1','install-artwork.ps1','verify-release.mjs','uninstall.ps1','check-data-permissions.ps1')) {
    Copy-Item -LiteralPath (Join-Path $project "scripts\$name") -Destination (Join-Path $stage 'scripts')
}
New-Item -ItemType Directory -Path (Join-Path $stage 'scripts\packaging') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'packaging\publisher.json') -Destination (Join-Path $stage 'scripts\packaging')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'packaging\HOSHINO-TEAM.cer') -Destination (Join-Path $stage 'scripts\packaging')
if (-not $NativeDirectory) { $NativeDirectory = Join-Path $project 'native\target\release' }
foreach ($name in @('xingye-desktop.exe','xingye-vault.exe')) {
    $binary = Join-Path $NativeDirectory $name
    if (-not (Test-Path -LiteralPath $binary)) { throw "Missing native release binary: $name" }
    Copy-Item -LiteralPath $binary -Destination $stage
    & (Join-Path $PSScriptRoot 'sign-release.ps1') -File (Join-Path $stage $name)
}
New-Item -ItemType Directory -Path (Join-Path $stage 'runtime') -Force | Out-Null
Copy-Item -LiteralPath $Node -Destination (Join-Path $stage 'runtime\node.exe')
$license = Join-Path $PSScriptRoot 'packaging\NODE-LICENSE.txt'
if (-not (Test-Path -LiteralPath $license)) { throw 'Missing bundled Node.js license.' }
if ((Get-FileHash -LiteralPath $license -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.licenseSha256) { throw 'Bundled Node.js license does not match the pinned upstream version.' }
Copy-Item -LiteralPath $license -Destination (Join-Path $stage 'runtime\LICENSE.txt')
Get-ChildItem -LiteralPath (Join-Path $stage 'scripts') -Filter '*.ps1' -File | ForEach-Object { & (Join-Path $PSScriptRoot 'sign-release.ps1') -File $_.FullName }
$hashes = @{}
Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object { $relative = $_.FullName.Substring($stage.Length + 1).Replace('\','/'); $hashes[$relative] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
$commit = (& git -C $project rev-parse HEAD) -join ''
@{version=$version; publisher='HOSHINO TEAM'; signingTrust='self-signed'; buildId=$buildId; commit=$commit; sourceDirty=$dirty; reviewOnly=$dirty; sourceStatus=$sourceStatus; runtime=@{version=$runtimeInfo.version; arch=$runtimeInfo.arch; url=$pin.url; sha256=$runtimeHash; checksums=$pin.checksums}; hashes=$hashes} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'BUILD-INFO.json') -Encoding UTF8
& (Join-Path $PSScriptRoot 'sign-release.ps1') -Manifest (Join-Path $stage 'BUILD-INFO.json')
Copy-Item -LiteralPath (Join-Path $stage 'BUILD-INFO.json') -Destination $releases
Copy-Item -LiteralPath (Join-Path $stage 'BUILD-INFO.json.sig') -Destination $releases
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, (Join-Path $work 'payload.zip'), [IO.Compression.CompressionLevel]::Optimal, $false)
foreach ($name in @('install.ps1','install.cmd','setup-wizard.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot "packaging\$name") -Destination $work }
Copy-Item -LiteralPath (Join-Path $project 'native\desktop\icons\icon.ico') -Destination $work
$publisher = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'packaging\publisher.json') -Raw | ConvertFrom-Json
$installerPath = Join-Path $work 'install.ps1'
$installerText = [IO.File]::ReadAllText($installerPath).Replace('__PUBLISHER_MODULUS__', $publisher.modulus).Replace('__PUBLISHER_EXPONENT__', $publisher.exponent)
[IO.File]::WriteAllText($installerPath, $installerText, [Text.UTF8Encoding]::new($true))
& (Join-Path $PSScriptRoot 'sign-release.ps1') -File $installerPath
$wizardPath = Join-Path $work 'setup-wizard.ps1'
[IO.File]::WriteAllText($wizardPath, [IO.File]::ReadAllText($wizardPath), [Text.UTF8Encoding]::new($true))
& (Join-Path $PSScriptRoot 'sign-release.ps1') -File $wizardPath
$exe = Join-Path $work 'xingyeji-windows-setup.exe'
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exe
FriendlyName=Xingye Journal $version
AppLaunched=cmd.exe /d /c install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
FILE0="payload.zip"
FILE1="install.ps1"
FILE2="install.cmd"
FILE3="setup-wizard.ps1"
FILE4="icon.ico"
[SourceFiles]
SourceFiles0=$work\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
%FILE4%=
"@
$sedPath = Join-Path $work 'package.sed'
[IO.File]::WriteAllText($sedPath, $sed, [Text.Encoding]::ASCII)
$builder = Start-Process -FilePath "$env:WINDIR\System32\iexpress.exe" -ArgumentList @('/N','/Q', $sedPath) -WindowStyle Hidden -PassThru -Wait
if ($builder.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $exe)) { throw "IExpress packaging failed: $($builder.ExitCode). Work: $work" }
# Versioned output was reserved before packaging.
$target = Join-Path $releases "xingyeji-$version-windows-x64-setup.exe"
Copy-Item -LiteralPath $exe -Destination $target
& (Join-Path $PSScriptRoot 'sign-release.ps1') -File $target
Copy-Item -LiteralPath (Join-Path $work 'payload.zip') -Destination $releases
$payloadDigest = (Get-FileHash -LiteralPath (Join-Path $work 'payload.zip') -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $releases 'payload.zip.sha256'), "$payloadDigest  payload.zip`n")
$digest = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($target + '.sha256', "$digest  $([IO.Path]::GetFileName($target))`n")
# Keep staging outside the installer for a reproducible extraction/startup check.
New-Item -ItemType Directory -Path (Join-Path $project '.tooling\packaging') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $project '.tooling\packaging\last-build.txt'), $work)
Write-Host "Created: $target"
Write-Host "Staging: $work"
