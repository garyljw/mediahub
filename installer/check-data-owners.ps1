# Run by the installer (elevated) before it trusts anything in the MediaHub data folder.
#
# C:\ProgramData lets standard users create folders, and a user owns what they create. Someone without admin
# rights could create the data folder before MediaHub is installed and plant a settings file in it. So every
# item in the folder must be owned by an administrator, SYSTEM, a service account or the MediaHub service's
# own account. A standard user cannot give a file to another owner, so this catches anything they created.
#
# Uses .NET calls only, no PowerShell modules: a Windows PowerShell started from PowerShell 7 can pick up
# PowerShell 7's module folders and fail to load cmdlets such as Get-Acl.
#
# Exit 0: the folder is missing or every owner is trusted. Exit 3: an item has another owner (printed).
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$ServiceAccount = ''
)
$ErrorActionPreference = 'Stop'

if (-not [System.IO.Directory]::Exists($Path)) { exit 0 }

$sidType = [System.Security.Principal.SecurityIdentifier]
$trusted = @('S-1-5-18', 'S-1-5-19', 'S-1-5-20', 'S-1-5-32-544')
if ($ServiceAccount -ne '' -and $ServiceAccount -ne 'LocalSystem') {
  # An account that cannot be looked up adds nothing: its files are then refused, never let through.
  try { $trusted += (New-Object System.Security.Principal.NTAccount($ServiceAccount)).Translate($sidType).Value } catch { }
}

$sections = [System.Security.AccessControl.AccessControlSections]::Owner

function Refuse([string]$message) {
  Write-Output $message
  exit 3
}

# Walked by hand, so links are never followed: MediaHub creates no junctions or symbolic links, and one planted
# here would report its target's owner, not its own. An item deleted during the walk (a log rolling over) is skipped.
$pending = New-Object System.Collections.Stack
$pending.Push($Path)
while ($pending.Count -gt 0) {
  $item = $pending.Pop()
  try {
    $attributes = [System.IO.File]::GetAttributes($item)
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { Refuse "$item is a link (junction or symbolic link)" }
    $isDir = ($attributes -band [System.IO.FileAttributes]::Directory) -ne 0
    if ($isDir) {
      $security = [System.IO.Directory]::GetAccessControl($item, $sections)
    } else {
      $security = [System.IO.File]::GetAccessControl($item, $sections)
    }
  } catch [System.IO.FileNotFoundException], [System.IO.DirectoryNotFoundException] {
    continue
  }
  $owner = $security.GetOwner($sidType).Value
  # S-1-5-80-* are per-service accounts such as NT SERVICE\MediaHub. Only Windows services run as them.
  if ($trusted -notcontains $owner -and -not $owner.StartsWith('S-1-5-80-')) {
    try { $name = (New-Object System.Security.Principal.SecurityIdentifier($owner)).Translate([System.Security.Principal.NTAccount]).Value } catch { $name = $owner }
    Refuse "$item is owned by $name"
  }
  if ($isDir) {
    try {
      foreach ($child in [System.IO.Directory]::GetFileSystemEntries($item)) { $pending.Push($child) }
    } catch [System.IO.DirectoryNotFoundException] {
      continue
    }
  }
}
exit 0
