param([Parameter(Mandatory=$true)][string]$InstallerInfoPath)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Run this isolated check in PowerShell 7.' }
$root = Split-Path -Parent $PSScriptRoot
$info = Get-Content -LiteralPath $InstallerInfoPath -Raw | ConvertFrom-Json
$probe = Join-Path $root ('tmp\installer-contract-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probe -Force | Out-Null
$results = [Collections.Generic.List[object]]::new()
function Run-Installer([string]$Executable, [string[]]$Arguments, [int]$Expected, [string]$Scenario) {
    $start = [Diagnostics.ProcessStartInfo]::new($Executable)
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true; $start.WindowStyle = 'Hidden'
    $start.Environment['PSModulePath'] = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\Modules'
    foreach($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    $visible = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while (-not $process.WaitForExit(100)) {
        if ([DateTime]::UtcNow -gt $deadline) { $process.Kill($true); $process.WaitForExit(); throw "$Scenario exceeded the installation timeout" }
        $process.Refresh(); if ($process.MainWindowHandle -ne [IntPtr]::Zero) { $visible = $true }
    }
    $actual = $process.ExitCode; $process.Dispose()
    if ($actual -ne $Expected -or $visible) { throw "$Scenario returned $actual, expected $Expected; bootstrapWindow=$visible" }
    $results.Add(@{scenario=$Scenario;exitCode=$actual;bootstrapWindow=$visible})
}
function Check([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$destination = Join-Path $probe "中文 folder's app"
$log = '/log=' + (Join-Path $probe 'installer.log')
$quietArgs = @($log,'/quiet','/norestart','/nodesktop','/nostartmenu',('/dir='+$destination))
try {
    Run-Installer $info.installer @($log,'/quiet','/unknown') 87 'unknown argument rejected'
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach($name in @('Setup','Install')) {
        $mutex = [Threading.Mutex]::new($false, ('Local\Hoshino.Xingye.'+$name+'.'+$sid))
        $held = $mutex.WaitOne(0)
        Check $held 'Cannot acquire isolated concurrency mutex'
        try { Run-Installer $info.installer $quietArgs 1618 ($name+' concurrent installation rejected') }
        finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
    }
    Run-Installer $info.installer $quietArgs 0 'silent install in Unicode apostrophe path'
    & (Join-Path $destination 'runtime\node.exe') (Join-Path $destination 'scripts\verify-release.mjs')
    Check ($LASTEXITCODE -eq 0) 'Installed payload integrity failed'
    foreach($folder in @('data','certs')) {
        New-Item -ItemType Directory -Path (Join-Path $destination $folder) -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $destination ($folder+'\sentinel.txt')), ('preserve-'+$folder))
    }
    Run-Installer $info.installer $quietArgs 0 'silent upgrade'
    foreach($folder in @('data','certs')) { Check ([IO.File]::ReadAllText((Join-Path $destination ($folder+'\sentinel.txt'))) -eq ('preserve-'+$folder)) "Upgrade changed $folder" }
    $runtime = [Diagnostics.ProcessStartInfo]::new((Join-Path $destination 'runtime\node.exe'))
    $runtime.UseShellExecute=$false; $runtime.CreateNoWindow=$true
    $runtime.ArgumentList.Add('-e'); $runtime.ArgumentList.Add('setInterval(()=>{},1000)')
    $running = [Diagnostics.Process]::Start($runtime)
    try { Run-Installer $info.installer $quietArgs 170 'running app prevents overwrite' }
    finally { if (-not $running.HasExited) { $running.Kill(); $running.WaitForExit() }; $running.Dispose() }

    $rollback = Join-Path $probe 'rollback-app'
    New-Item -ItemType Directory -Path $rollback -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $rollback 'server.mjs'), 'previous-program')
    [IO.File]::WriteAllText((Join-Path $rollback 'runtime'), 'existing-file-blocks-runtime-folder')
    Run-Installer $info.installer @($log,'/quiet','/nodesktop','/nostartmenu',('/dir='+$rollback)) 1603 'file collision rolls back installation'
    Check ([IO.File]::ReadAllText((Join-Path $rollback 'server.mjs')) -eq 'previous-program') 'Rollback did not restore the previous server'
    Check (-not (Test-Path -LiteralPath (Join-Path $rollback 'package.json'))) 'Rollback left newly installed program files'

    $tamper = Join-Path $probe 'tampered-package'
    New-Item -ItemType Directory -Path $tamper -Force | Out-Null
    foreach($file in @('payload.zip','install.ps1','setup-wizard.ps1','icon.ico')) { Copy-Item -LiteralPath (Join-Path $info.work $file) -Destination $tamper }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::Open((Join-Path $tamper 'payload.zip'), [IO.Compression.ZipArchiveMode]::Update)
    try { $entry=$zip.GetEntry('server.mjs'); Check ($null -ne $entry) 'Missing source fixture'; $entry.Delete(); $replacement=$zip.CreateEntry('server.mjs'); $writer=[IO.StreamWriter]::new($replacement.Open()); try{$writer.Write('tampered')}finally{$writer.Dispose()} } finally { $zip.Dispose() }
    $tamperExe=Join-Path $tamper 'tampered.exe'
    & (Join-Path $PSScriptRoot 'build-installer.ps1') -WorkDirectory $tamper -OutputFile $tamperExe -Version $info.version
    Run-Installer $tamperExe @($log,'/quiet','/nodesktop','/nostartmenu',('/dir='+(Join-Path $probe 'must-not-install'))) 13 'tampered payload rejected before destination creation'
    Check (-not (Test-Path -LiteralPath (Join-Path $probe 'must-not-install'))) 'Tampered package created an installation destination'

    $guiCheck = Join-Path $probe 'gui-cancel.ps1'
    $wizard=(Join-Path $info.work 'setup-wizard.ps1').Replace("'","''")
    [IO.File]::WriteAllText($guiCheck, (". '$wizard' -PrepareOnly; " + '$form.Opacity=0; $form.Show(); $form.Close(); $form.Dispose(); exit $script:setupExitCode'), [Text.UTF8Encoding]::new($true))
    $systemPowerShell=Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
    Run-Installer $systemPowerShell @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',$guiCheck) 1602 'hidden manual wizard cancellation'
    $results.Add(@{scenario='upgrade preserves data and certs; installed signature hashes verified';passed=$true})
    $report=@{passed=$true;installer=$info.installer;sha256=(Get-FileHash -LiteralPath $info.installer -Algorithm SHA256).Hash.ToLowerInvariant();checks=$results.ToArray()}
    $reportPath=Join-Path (Split-Path -Parent $InstallerInfoPath) 'INSTALLER-VERIFICATION.json'
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
    $report | ConvertTo-Json -Depth 6
} catch {
    $failure = $_
    if (Test-Path -LiteralPath (Join-Path $probe 'installer.log')) {
        Copy-Item -LiteralPath (Join-Path $probe 'installer.log') -Destination (Join-Path (Split-Path -Parent $InstallerInfoPath) 'INSTALLER-CHECK-FAILURE.log')
        Get-Content -LiteralPath (Join-Path $probe 'installer.log') -Tail 12 | Write-Host
    }
    throw $failure
} finally {
    $resolved=[IO.Path]::GetFullPath($probe)
    $allowed=(Join-Path ([IO.Path]::GetFullPath($root)) 'tmp').TrimEnd('\')+'\'
    if (-not $resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^installer-contract-[a-f0-9]{32}$') { throw 'Unsafe test cleanup target' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
