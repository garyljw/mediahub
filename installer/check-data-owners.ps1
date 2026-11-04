# Run by the installer (elevated) before it trusts anything in the MediaHub data folder.
#
# C:\ProgramData lets standard users create folders, and a user owns what they create. Someone without admin
# rights could create the data folder before MediaHub is installed and plant a settings file in it. So every
# item in the folder must be owned by an administrator, SYSTEM, a service account or the MediaHub service's
# own account. A standard user cannot give a file to another owner, so this catches anything they created.
#
# Exit 0: the folder is missing or every owner is trusted. Exit 3: an item has another owner (printed).
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$ServiceAccount = ''
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) { exit 0 }

$trusted = @('S-1-5-18', 'S-1-5-19', 'S-1-5-20', 'S-1-5-32-544')
if ($ServiceAccount -ne '' -and $ServiceAccount -ne 'LocalSystem') {
  # An account that cannot be looked up adds nothing: its files are then refused, never let through.
  try { $trusted += (New-Object System.Security.Principal.NTAccount($ServiceAccount)).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { }
}

$items = @(Get-Item -LiteralPath $Path -Force) + @(Get-ChildItem -LiteralPath $Path -Recurse -Force)
foreach ($item in $items) {
  $owner = (Get-Acl -LiteralPath $item.FullName).GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  # S-1-5-80-* are per-service accounts such as NT SERVICE\MediaHub. Only Windows services run as them.
  if ($trusted -notcontains $owner -and -not $owner.StartsWith('S-1-5-80-')) {
    try { $name = (New-Object System.Security.Principal.SecurityIdentifier($owner)).Translate([System.Security.Principal.NTAccount]).Value } catch { $name = $owner }
    Write-Output "$($item.FullName) is owned by $name"
    exit 3
  }
}
exit 0
