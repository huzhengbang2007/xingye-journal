param([string]$Directory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data'))
$ErrorActionPreference = 'Stop'
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$permittedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
$items = @((Get-Item -LiteralPath $Directory -Force)) + @(Get-ChildItem -LiteralPath $Directory -File -Filter '*.vault*')
$findings = @()
foreach ($item in $items) {
    $acl = Get-Acl -LiteralPath $item.FullName
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $permittedSids) {
            $findings += [PSCustomObject]@{ Path=$item.FullName; Principal=$rule.IdentityReference.Value; Rights=[string]$rule.FileSystemRights; Inherited=$rule.IsInherited }
        }
    }
}
if ($findings.Count) { $findings | Format-Table -AutoSize; Write-Warning 'Other principals have access. This check does not change permissions.'; exit 1 }
Write-Host 'No additional allowed principals found. Permissions were not changed.'
