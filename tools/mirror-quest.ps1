param([string]$Serial = '', [string]$Crop = '', [string]$Record = '', [int]$Seconds = 0, [switch]$Diagnostics)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $repo '.local\platform-tools\adb.exe'
$mirror = Join-Path $repo '.local\scrcpy\scrcpy-win64-v5.0.1\scrcpy.exe'
if (!(Test-Path -LiteralPath $mirror)) { throw 'Install the official scrcpy 5.0.1 Windows release into .local/scrcpy first (see apps/quest/README.md).' }
$devices = @(& $adb devices | Where-Object { $_ -match '^\S+\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (!$Serial) { if ($devices.Count -ne 1) { throw 'Connect one Quest and allow USB debugging, or supply -Serial.' }; $Serial = $devices[0] }
if ($Serial -notin $devices) { throw 'Quest USB debugging is not connected.' }
$env:ADB = $adb
# The live laptop check recovered after restarting with software H.264 decoding.
# Keep that verified playback path; this does not change headset rendering.
$arguments = @('--serial', $Serial, '--no-control', '--no-audio', '--max-size=1920', '--max-fps=30', '--video-codec=h264', '--hwdec=disabled', '--window-title=Beacon Quest Demo')
if ($Diagnostics) { $arguments += '--print-fps' }
if ($Crop) { if ($Crop -notmatch '^\d+:\d+:\d+:\d+$') { throw 'Crop must be width:height:x:y' }; $arguments += ('--crop=' + $Crop) }
if ($Record) {
    $recordPath = [IO.Path]::GetFullPath($Record)
    if (Test-Path -LiteralPath $recordPath) { throw 'Recording already exists. Choose a new filename.' }
    $arguments += ('--record=' + $recordPath)
}
if ($Seconds -gt 0) { $arguments += ('--time-limit=' + $Seconds) }
& $mirror @arguments
if ($LASTEXITCODE -ne 0) { throw 'USB mirroring stopped with an error.' }
