param([string]$Serial = '', [string]$Crop = '')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $repo '.local\platform-tools\adb.exe'
$mirror = Join-Path $repo '.local\scrcpy\scrcpy-win64-v5.0.1\scrcpy.exe'
if (!(Test-Path -LiteralPath $mirror)) { throw 'Install the official scrcpy 5.0.1 Windows release into .local/scrcpy first (see apps/quest/README.md).' }
$devices = @(& $adb devices | Where-Object { $_ -match '^\S+\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (!$Serial) { if ($devices.Count -ne 1) { throw 'Connect one Quest and allow USB debugging, or supply -Serial.' }; $Serial = $devices[0] }
if ($Serial -notin $devices) { throw 'Quest USB debugging is not connected.' }
$env:ADB = $adb
$arguments = @('--serial', $Serial, '--no-control', '--no-audio', '--max-size=1920', '--max-fps=30', '--window-title=Beacon Quest Demo')
if ($Crop) { if ($Crop -notmatch '^\d+:\d+:\d+:\d+$') { throw 'Crop must be width:height:x:y' }; $arguments += ('--crop=' + $Crop) }
& $mirror @arguments
if ($LASTEXITCODE -ne 0) { throw 'USB mirroring stopped with an error.' }
