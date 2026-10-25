$ErrorActionPreference = "Stop"
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
$admin = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
$powerUsers = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-547")
@{
  sid = $identity.User.Value
  admin = [bool]$principal.IsInRole($admin)
  powerUsers = [bool]$principal.IsInRole($powerUsers)
} | ConvertTo-Json -Compress
