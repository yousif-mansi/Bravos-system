# Fixed Bravos native print helper. No arguments. One JSON object on stdin.
# probe and preview never call Print. Empty input exits before any print path.
$ErrorActionPreference = "Stop"
if ($args.Count -ne 0) { exit 2 }

$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

$stdin = [Console]::OpenStandardInput()
$buffer = New-Object byte[] 48001
$read = 0
while ($read -lt 48001) {
  $n = $stdin.Read($buffer, $read, 48001 - $read)
  if ($n -le 0) { break }
  $read += $n
}
if ($read -lt 2 -or $read -gt 48000) { exit 3 }
$json = $utf8.GetString($buffer, 0, $read).TrimStart([char]0xFEFF)
if ($json.Length -lt 2) { exit 3 }

try {
  $msg = $json | ConvertFrom-Json
} catch {
  exit 5
}
$action = [string]$msg.action
if ($action -ne "probe" -and $action -ne "preview" -and $action -ne "print") { exit 5 }

$source = Join-Path $PSScriptRoot "native-print.cs"
$connector = Split-Path $PSScriptRoot -Parent
$font = Join-Path $connector "assets\Cairo-Regular.ttf"
$logo = Join-Path $connector "assets\bravos-receipt-logo.png"
Add-Type -Path $source -ReferencedAssemblies @(
  "System.Drawing",
  "System.Windows.Forms",
  "System.Web.Extensions"
)

function Read-Queue([string]$role, [string]$printerName) {
  $found = $false
  $driver = ""
  $offline = $false
  $port = ""
  $status = ""
  $printers = @(Get-CimInstance -ClassName Win32_Printer)
  foreach ($printer in $printers) {
    if ([string]$printer.Name -eq $printerName) {
      $found = $true
      $driver = [string]$printer.DriverName
      $offline = [bool]$printer.WorkOffline
      $port = [string]$printer.PortName
      $status = [string]$printer.PrinterState
      break
    }
  }
  $devices = @(Get-CimInstance -ClassName Win32_PnPEntity | Where-Object {
    [string]$_.PNPDeviceID -like "USBPRINT\*"
  })
  $truncated = $devices.Count -gt 16
  $take = $devices.Count
  if ($take -gt 16) { $take = 16 }
  $ids = New-Object string[] $take
  $statuses = New-Object string[] $take
  for ($i = 0; $i -lt $take; $i++) {
    $ids[$i] = [string]$devices[$i].PNPDeviceID
    $statuses[$i] = [string]$devices[$i].Status
  }
  return [Bravos.NativePrint.Host]::ProbeQueue($role, $found, $driver, $offline, $port, $status, $truncated, $ids, $statuses)
}

try {
  if ($action -eq "probe") {
    $label = Read-Queue "label" "Xprinter XP-236B"
    $receipt = Read-Queue "receipt" "Bravos Receipts - Xprinter XP-80TS"
    $text = [Bravos.NativePrint.Host]::ProbeEnvelope($label, $receipt)
  } elseif ($action -eq "preview") {
    $text = [Bravos.NativePrint.Host]::Preview($json, $font, $logo)
  } elseif ($action -eq "print") {
    $text = [Bravos.NativePrint.Host]::PrintJob($json, $font, $logo)
  } else {
    exit 5
  }
  if ([string]::IsNullOrEmpty($text)) { exit 4 }
  [Console]::Out.Write($text)
} catch {
  exit 4
}
