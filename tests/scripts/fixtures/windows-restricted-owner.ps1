param(
  [Parameter(Mandatory = $true)]
  [string] $LiteralPath
)
$ErrorActionPreference = "Stop"
$acl = Get-Acl -LiteralPath $LiteralPath
Write-Output $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
