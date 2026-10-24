param([string]$Cargo = 'cargo', [string]$Node, [switch]$CheckOnly, [switch]$AllowDirtyReview)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$pin = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'packaging\node-runtime.json') -Raw | ConvertFrom-Json
if (-not $Node) { $Node = Join-Path $project ".tooling\node-$($pin.version)\node.exe" }
if (-not (Test-Path -LiteralPath $Node) -or (Get-FileHash -LiteralPath $Node -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.sha256) { throw 'Native preview requires the pinned official Node.js binary.' }
$manifest = Join-Path $project 'native\Cargo.toml'
& $Cargo test --manifest-path $manifest -p xingye-vault --locked
if ($LASTEXITCODE -ne 0) { throw 'Rust vault tests failed.' }
& $Cargo build --manifest-path $manifest --workspace --release --locked
if ($LASTEXITCODE -ne 0) { throw 'Rust native build failed.' }
$env:XINGYE_TEST_VAULT_HELPER = Join-Path $project 'native\target\release\xingye-vault.exe'
try {
  & $Node --test (Join-Path $project 'tests\native-vault.test.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Rust / Node compatibility checks failed.' }
} finally { Remove-Item Env:XINGYE_TEST_VAULT_HELPER -ErrorAction SilentlyContinue }
if ($CheckOnly) { return }
# The native desktop is now the standard signed Windows payload, not an unsigned preview.
& (Join-Path $PSScriptRoot 'build-windows.ps1') -Node $Node -NativeDirectory (Join-Path $project 'native\target\release') -AllowDirtyReview:$AllowDirtyReview
