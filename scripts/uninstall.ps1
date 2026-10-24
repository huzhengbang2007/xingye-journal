[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')]
param([switch]$RemoveApplication)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$manifest = Get-Content -LiteralPath (Join-Path $root 'BUILD-INFO.json') -Raw | ConvertFrom-Json
$files = @($manifest.hashes.PSObject.Properties.Name) + @('BUILD-INFO.json','BUILD-INFO.json.sig')
$targets = @()
foreach ($relative in $files) {
    $target = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $target.StartsWith($root.TrimEnd('\')+'\', [StringComparison]::OrdinalIgnoreCase) -or $relative -match '(^|[/\\])(data|certs|\.signing|\.env)([/\\]|$)') { throw 'Unsafe uninstall manifest; personal data will not be removed.' }
    $targets += $target
}
if (-not $RemoveApplication) { Write-Host 'Preview only. Run with -RemoveApplication to remove program files. Personal data and certificates are always preserved.'; $targets; exit 0 }
$running = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -in @((Join-Path $root 'runtime\node.exe'),(Join-Path $root 'xingye-desktop.exe')) }
if ($running) { throw 'Close Xingye Journal before uninstalling.' }
if ($PSCmdlet.ShouldProcess($root, 'Remove application files; preserve data and certs')) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcutName = ([string][char]0x661F) + [char]0x91CE + [char]0x8BB0 + '.lnk'
    foreach ($directory in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs'))) {
        if (-not $directory) { continue }
        $link = Join-Path $directory $shortcutName
        if (Test-Path -LiteralPath $link) {
            $shortcut = $shell.CreateShortcut($link)
            if ($shortcut.TargetPath -in @((Join-Path $root 'xingye-desktop.exe'),(Join-Path $root 'start.cmd'))) { Remove-Item -LiteralPath $link }
        }
    }
    foreach ($target in $targets) { if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target } }
    Write-Host "Application files removed. Personal data remains at: $(Join-Path $root 'data')"
}
