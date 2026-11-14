param([int]$Port = 5173, [string]$Serial = '', [switch]$Demo)
if ($Demo) { $Port = 5174 }
$pagePath = if ($Demo) { '/headset/' } else { '/apps/headset/' }
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$localAdb = Join-Path $repoRoot '.local\platform-tools\adb.exe'
$sdkAdb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (Test-Path -LiteralPath $localAdb) { $adb = $localAdb }
elseif (Test-Path -LiteralPath $sdkAdb) { $adb = $sdkAdb }
elseif (Get-Command adb -ErrorAction SilentlyContinue) { $adb = (Get-Command adb).Source }
else { throw 'Android Platform Tools are missing. Download the Windows ZIP from https://developer.android.com/tools/releases/platform-tools and extract platform-tools into this project''s .local folder.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a port between 1024 and 65535.' }
$listing = @(& $adb devices)
if ($LASTEXITCODE -ne 0) { throw 'Could not read connected devices.' }
$devices = @($listing | Where-Object { $_ -match '^\S+\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (!$devices.Count) {
  if ($listing -match 'unauthorized') { throw 'Put on the Quest and accept Allow USB debugging, then run this again.' }
  throw 'No headset detected. Enable Developer Mode, connect a USB data cable, wake the Quest and accept USB debugging.'
}
if (!$Serial) {
  if ($devices.Count -gt 1) { throw 'More than one Android device is connected. Re-run with -Serial followed by the Quest serial.' }
  $Serial = $devices[0]
}
if ($Serial -notin $devices) { throw 'That device is not connected or not authorized.' }
$model = (& $adb -s $Serial shell getprop ro.product.model).Trim()
if ($model -notmatch 'Quest') { throw "Connected device is '$model', not a Quest. Connect the headset and try again." }
try { Invoke-WebRequest -Uri "http://127.0.0.1:$Port$pagePath" -UseBasicParsing -TimeoutSec 5 | Out-Null }
catch { throw 'Beacon is not running. Use Start Laptop Demo.cmd with -Demo, or Start Beacon.cmd without -Demo, then try again.' }
& $adb -s $Serial reverse "tcp:$Port" "tcp:$Port"
if ($LASTEXITCODE -ne 0) { throw 'USB port forwarding failed.' }
$url = "http://localhost:$Port$pagePath"
& $adb -s $Serial shell am start -a android.intent.action.VIEW -d $url
if ($LASTEXITCODE -ne 0) { Write-Host "Open the Quest browser yourself and visit $url" }
Write-Host "`nReady: $url`nKeep the USB cable connected. In the Quest browser choose Enter AR."
if ($Demo) { Write-Host "Use the hub at http://127.0.0.1:$Port/hub/ for Next, Storm and Reset." }
else { Write-Host "Use the laptop's Next waypoint and Trigger storm controls while wearing the headset." }
