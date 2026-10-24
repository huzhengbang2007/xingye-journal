param([string]$Destination = (Join-Path $env:LOCALAPPDATA 'XingyeJournal'), [switch]$NoShortcut, [switch]$NoLaunch,
    [switch]$NoStartMenu, [string]$DesktopDirectory = [Environment]::GetFolderPath('DesktopDirectory'),
    [string]$ProgramsDirectory = [Environment]::GetFolderPath('Programs'))
$ErrorActionPreference = 'Stop'
$changed = [Collections.Generic.List[string]]::new()
$installed = $false
$failureCode = 1603
$installMutex = $null
$ownsInstallMutex = $false
function Stop-Installation([int]$Code, [string]$Message) {
    $exception = New-Object InvalidOperationException($Message)
    $exception.Data['InstallerExitCode'] = $Code
    throw $exception
}
try {
    $installMutex = New-Object Threading.Mutex($false, ('Local\Hoshino.Xingye.Install.' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value))
    try { $ownsInstallMutex = $installMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsInstallMutex = $true }
    if (-not $ownsInstallMutex) { Stop-Installation 1618 'Another Xingye installation is running.' }
    $failureCode = 87
    if (-not [IO.Path]::IsPathRooted($Destination)) { Stop-Installation 87 'Choose an absolute installation directory.' }
    $destinationPath = [IO.Path]::GetFullPath($Destination)
    if ([IO.Path]::GetPathRoot($destinationPath) -eq $destinationPath) { throw 'Choose an application folder, not a drive root.' }
    $runtimePath = Join-Path $destinationPath 'runtime\node.exe'
    $desktopPath = Join-Path $destinationPath 'xingye-desktop.exe'
    $running = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'xingye-desktop.exe'" | Where-Object { $_.ExecutablePath -and ([string]::Equals($_.ExecutablePath, $runtimePath, [StringComparison]::OrdinalIgnoreCase) -or [string]::Equals($_.ExecutablePath, $desktopPath, [StringComparison]::OrdinalIgnoreCase)) }
    if ($running) { Stop-Installation 170 'Close Xingye Journal before updating.' }
    $failureCode = 13
    $work = Join-Path ([IO.Path]::GetTempPath()) ('xingye-install-' + [Guid]::NewGuid().ToString('N'))
    $stage = Join-Path $work 'stage'
    $backup = Join-Path $work 'rollback'
    New-Item -ItemType Directory -Path $stage,$backup -Force | Out-Null
    # The payload contains only application files; existing data and certificates stay in place.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $PSScriptRoot 'payload.zip'))
    try {
        $prefix = $stage.TrimEnd('\') + '\'
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $stage $entry.FullName))
            if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid archive path.' }
            if ($entry.FullName -match '(^|[/\\])(data|certs|\.signing|\.env)([/\\]|$)') { throw 'Unexpected private file in archive.' }
            if (-not $entry.Name) { New-Item -ItemType Directory -Path $target -Force | Out-Null; continue }
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
    } finally { $zip.Dispose() }
    $manifest = Get-Content -LiteralPath (Join-Path $stage 'BUILD-INFO.json') -Raw | ConvertFrom-Json
    $rsa = [Security.Cryptography.RSA]::Create()
    $parameters = New-Object Security.Cryptography.RSAParameters
    $parameters.Modulus = [Convert]::FromBase64String('__PUBLISHER_MODULUS__')
    $parameters.Exponent = [Convert]::FromBase64String('__PUBLISHER_EXPONENT__')
    try {
        $rsa.ImportParameters($parameters)
        $signature = [Convert]::FromBase64String(([IO.File]::ReadAllText((Join-Path $stage 'BUILD-INFO.json.sig'))).Trim())
        if (-not $rsa.VerifyData([IO.File]::ReadAllBytes((Join-Path $stage 'BUILD-INFO.json')), $signature, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)) { throw 'HOSHINO TEAM manifest signature verification failed.' }
    } finally { $rsa.Dispose() }
    if ($manifest.publisher -ne 'HOSHINO TEAM') { throw 'Unexpected release publisher.' }
    foreach ($property in $manifest.hashes.PSObject.Properties) {
        $file = [IO.Path]::GetFullPath((Join-Path $stage $property.Name))
        if (-not $file.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $property.Value) { throw 'Payload hash verification failed.' }
    }
    $files = @(Get-ChildItem -LiteralPath $stage -File -Recurse)
    if ($files.Count -ne @($manifest.hashes.PSObject.Properties).Count + 2) { throw 'Unexpected payload file.' }
    $failureCode = 1603
    $driveRoot = [IO.Path]::GetPathRoot($destinationPath)
    if ($driveRoot -match '^[A-Za-z]:\\$') {
        $driveInfo = New-Object IO.DriveInfo($driveRoot)
        $requiredBytes = 2 * ($files | Measure-Object Length -Sum).Sum + 32MB
        if ($driveInfo.AvailableFreeSpace -lt $requiredBytes) { Stop-Installation 112 'Not enough free space for installation and rollback.' }
    }
    New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($stage.Length + 1)
        $target = Join-Path $destinationPath $relative
        $previous = Join-Path $backup $relative
        if (Test-Path -LiteralPath $target) { New-Item -ItemType Directory -Path (Split-Path -Parent $previous) -Force | Out-Null; Copy-Item -LiteralPath $target -Destination $previous }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        $changed.Add($relative)
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }
    # Retire old user-facing connection scripts, retaining rollback on an interrupted upgrade.
    foreach ($relative in @('scripts\connection-options.ps1','scripts\setup-https.ps1','scripts\start-https.ps1')) {
        $obsolete = [IO.Path]::GetFullPath((Join-Path $destinationPath $relative))
        if (-not $obsolete.StartsWith($destinationPath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid retired file path.' }
        if (Test-Path -LiteralPath $obsolete) {
            $previous = Join-Path $backup $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $previous) -Force | Out-Null
            Copy-Item -LiteralPath $obsolete -Destination $previous
            $changed.Add($relative)
            Remove-Item -LiteralPath $obsolete
        }
    }
    if (-not $NoShortcut -or -not $NoStartMenu) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcutName = ([string][char]0x661F) + [char]0x91CE + [char]0x8BB0 + '.lnk'
        $shortcutDirectories = @()
        if (-not $NoShortcut) { $shortcutDirectories += $DesktopDirectory }
        if (-not $NoStartMenu) { $shortcutDirectories += $ProgramsDirectory }
        foreach ($directory in $shortcutDirectories) {
            if (-not $directory) { throw 'Windows shortcut folder is unavailable.' }
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
            $shortcut = $shell.CreateShortcut((Join-Path $directory $shortcutName))
            $shortcut.TargetPath = Join-Path $destinationPath 'xingye-desktop.exe'
            $shortcut.IconLocation = (Join-Path $destinationPath 'xingye-desktop.exe') + ',0'
            $shortcut.WorkingDirectory = $destinationPath
            $shortcut.Description = 'Xingye Journal - HOSHINO TEAM'
            $shortcut.Save()
        }
    }
    $installed = $true
    Write-Host "Installed: $destinationPath"
    Write-Host "Personal data retained at: $(Join-Path $destinationPath 'data')"
    $cleanupTarget = [IO.Path]::GetFullPath($work)
    $temporaryPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($cleanupTarget.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($cleanupTarget) -match '^xingye-install-[a-f0-9]{32}$') {
        try { Remove-Item -LiteralPath $cleanupTarget -Recurse -Force } catch { Write-Warning 'Installed successfully; temporary staging could not be removed.' }
    }
    if (-not $NoLaunch) {
        try { Start-Process -FilePath (Join-Path $destinationPath 'start.cmd') -WorkingDirectory $destinationPath -WindowStyle Hidden }
        catch { Write-Warning 'Installed successfully; open start.cmd to launch the application.' }
    }
} catch {
    $originalError = $_
    $exitCode = $failureCode
    $exception = $_.Exception
    while ($exception) {
        if ($exception.Data.Contains('InstallerExitCode')) { $exitCode = [int]$exception.Data['InstallerExitCode']; break }
        if ($exception -is [UnauthorizedAccessException]) { $exitCode = 5; break }
        if ($exception -is [IO.IOException] -and (($exception.HResult -band 0xffff) -in @(112,39))) { $exitCode = 112; break }
        $exception = $exception.InnerException
    }
    if (-not $installed) {
        $rollbackFiles = $changed.ToArray()
        [array]::Reverse($rollbackFiles)
        foreach ($relative in $rollbackFiles) {
            $target = [IO.Path]::GetFullPath((Join-Path $destinationPath $relative))
            if (-not $target.StartsWith($destinationPath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
            $previous = Join-Path $backup $relative
            try {
                if (Test-Path -LiteralPath $previous) { Copy-Item -LiteralPath $previous -Destination $target -Force }
                elseif (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
            } catch { Write-Warning "Rollback needs attention; retained backup: $backup" }
        }
    }
    Write-Host "Installation failed ($exitCode): $($originalError.Exception.Message)"
    if (-not $NoLaunch) { Read-Host 'Press Enter to close' }
    exit $exitCode
} finally {
    if ($ownsInstallMutex) { $installMutex.ReleaseMutex() }
    if ($installMutex) { $installMutex.Dispose() }
}
exit 0
