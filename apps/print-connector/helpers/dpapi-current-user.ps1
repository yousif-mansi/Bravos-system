# Fixed Bravos print-connector helper. CurrentUser DPAPI only.
# Arguments are refused. One JSON object arrives on stdin and one base64 line leaves on stdout.
$ErrorActionPreference = "Stop"
if ($args.Count -ne 0) { exit 2 }
try {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrEmpty($raw) -or $raw.Length -gt 12000) { exit 3 }
  $msg = $raw | ConvertFrom-Json
  if ($msg.op -ne "protect" -and $msg.op -ne "unprotect") { exit 5 }
  $bytes = [Convert]::FromBase64String([string]$msg.payloadBase64)
  if ($null -eq $bytes -or $bytes.Length -lt 1 -or $bytes.Length -gt 4096) { exit 6 }
  Add-Type -AssemblyName System.Security
  $entropy = [Text.Encoding]::UTF8.GetBytes("bravos-print-connector-pairing-v1")
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($msg.op -eq "protect") {
    $out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope)
  } else {
    $out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope)
  }
  if ($null -eq $out -or $out.Length -lt 1) { exit 7 }
  [Console]::Out.Write([Convert]::ToBase64String($out))
} catch {
  exit 4
}
