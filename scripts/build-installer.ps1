param(
    [Parameter(Mandatory=$true)][string]$WorkDirectory,
    [Parameter(Mandatory=$true)][string]$OutputFile,
    [Parameter(Mandatory=$true)][string]$Version,
    [ValidateRange(1,65535)][int]$Revision = 2
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid application version.' }
$assemblyVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).$Revision"
$framework = Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler unavailable.' }
$sourcePath = Join-Path $WorkDirectory 'installer.generated.cs'
$sourceText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'packaging\Installer.cs')).Replace('__ASSEMBLY_VERSION__', $assemblyVersion).Replace('__PRODUCT_VERSION__', $Version)
[IO.File]::WriteAllText($sourcePath, $sourceText, [Text.UTF8Encoding]::new($false))
$manifestPath = Join-Path $WorkDirectory 'installer.manifest'
$manifest = @'
<?xml version="1.0" encoding="utf-8"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" name="Hoshino.Xingye.Installer"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application></compatibility>
</assembly>
'@
[IO.File]::WriteAllText($manifestPath, $manifest, [Text.UTF8Encoding]::new($false))
$arguments = @('/nologo','/noconfig','/nostdlib+','/target:winexe','/platform:anycpu','/optimize+',("/out:$OutputFile"),("/win32manifest:$manifestPath"),("/win32icon:" + (Join-Path $WorkDirectory 'icon.ico')))
foreach ($assembly in @('mscorlib.dll','System.dll','System.Core.dll','System.Security.dll','System.Windows.Forms.dll')) {
    $arguments += '/reference:' + (Join-Path $framework $assembly)
}
foreach ($name in @('payload.zip','install.ps1','setup-wizard.ps1','icon.ico')) {
    $resourcePath = Join-Path $WorkDirectory $name
    if (-not (Test-Path -LiteralPath $resourcePath)) { throw "Missing installer resource: $name" }
    $arguments += "/resource:$resourcePath,$name"
}
$arguments += $sourcePath
& $compiler @arguments
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $OutputFile)) { throw 'Installer bootstrap compilation failed.' }
Write-Host "Compiled installer $Version revision $Revision"
