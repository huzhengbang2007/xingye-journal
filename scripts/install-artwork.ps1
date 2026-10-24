param([string]$Hero, [string]$Mascot, [string]$Cover)
$ErrorActionPreference = 'Stop'
if (-not $Hero -and -not $Mascot -and -not $Cover) { throw 'Provide -Hero, -Mascot or -Cover with a PNG file path.' }
$projectDirectory = Split-Path -Parent $PSScriptRoot
$assetDirectory = Join-Path $projectDirectory 'public\assets'
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null
foreach ($item in @(@{ Source = $Hero; Name = 'hero.png' }, @{ Source = $Mascot; Name = 'mascot.png' }, @{ Source = $Cover; Name = 'cover.png' })) {
  if (-not $item.Source) { continue }
  $sourceFile = Get-Item -LiteralPath $item.Source
  if ($sourceFile.Length -gt 12MB -or $sourceFile.Length -lt 24) { throw 'Each PNG must be between 24 bytes and 12 MB.' }
  $stream = [System.IO.File]::OpenRead($sourceFile.FullName)
  try { $signature = New-Object byte[] 8; $null = $stream.Read($signature,0,8) } finally { $stream.Dispose() }
  if ([BitConverter]::ToString($signature) -ne '89-50-4E-47-0D-0A-1A-0A') { throw 'This is not a valid PNG file.' }
  $targetPath = Join-Path $assetDirectory $item.Name
  if ($sourceFile.FullName -ne $targetPath) { Copy-Item -LiteralPath $sourceFile.FullName -Destination $targetPath -Force }
  Write-Host "Installed $($item.Name). Refresh Xingye Journal to see it."
}
