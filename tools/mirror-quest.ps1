param([string]$Serial = '', [string]$Crop = '', [string]$Record = '', [int]$Seconds = 0, [switch]$Diagnostics,
    [ValidateSet('Left','Right','Both')][string]$Eye = 'Left', [Nullable[double]]$Angle)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $repo '.local\platform-tools\adb.exe'
$mirror = Join-Path $repo '.local\scrcpy\scrcpy-win64-v5.0.1\scrcpy.exe'
if (!(Test-Path -LiteralPath $mirror)) { throw 'Install the official scrcpy 5.0.1 Windows release into .local/scrcpy first (see apps/quest/README.md).' }
$devices = @(& $adb devices | Where-Object { $_ -match '^\S+\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (!$Serial) { if ($devices.Count -ne 1) { throw 'Connect one Quest and allow USB debugging, or supply -Serial.' }; $Serial = $devices[0] }
if ($Serial -notin $devices) { throw 'Quest USB debugging is not connected.' }
$power = (& $adb -s $Serial shell dumpsys power) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Could not check whether the Quest is awake.' }
if ($power -notmatch 'mWakefulness=Awake\b') {
    Write-Warning 'The Quest is asleep. Put it on and open Beacon, then run Mirror Quest USB.cmd to start a live picture.'
    return
}
$env:ADB = $adb
if ($null -eq $Angle) {
    $model = (& $adb -s $Serial shell getprop ro.product.model).Trim()
    $Angle = if ($model -eq 'Quest 3' -and $Eye -eq 'Left') { 22.0 } elseif ($model -eq 'Quest 3' -and $Eye -eq 'Right') { -22.0 } else { 0.0 }
}
# Close only our previous video windows; their helpers clean up their USB ports.
Get-Process -Name scrcpy,ffplay -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -eq 'Beacon Quest Demo' -and $_.Path.StartsWith((Join-Path $repo '.local\'),[StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object {if(!$_.CloseMainWindow()) {Stop-Process -Id $_.Id}}
if($Eye -ne 'Both' -or $Crop -or $Angle -ne 0) {
    & (Join-Path $PSScriptRoot 'mirror-quest-client.ps1') -Serial $Serial -Eye $Eye -Crop $Crop -Angle $Angle -Record $Record -Seconds $Seconds -Diagnostics:$Diagnostics
    return
}
# The live laptop check recovered after restarting with software H.264 decoding.
# Keep that verified playback path; this does not change headset rendering.
$arguments = @('--serial', $Serial, '--no-control', '--no-audio', '--max-size=1920', '--max-fps=30', '--video-codec=h264', '--hwdec=disabled', '--window-title=Beacon Quest Demo')
if ($Diagnostics) { $arguments += '--print-fps' }
if ($Crop) { if ($Crop -notmatch '^\d+:\d+:\d+:\d+$') { throw 'Crop must be width:height:x:y' }; $arguments += ('--crop=' + $Crop) }
if ($Angle -ne 0) { $arguments += ('--angle=' + ([double]$Angle).ToString([Globalization.CultureInfo]::InvariantCulture)) }
if ($Record) {
    $recordPath = [IO.Path]::GetFullPath($Record)
    if (Test-Path -LiteralPath $recordPath) { throw 'Recording already exists. Choose a new filename.' }
    $arguments += ('--record=' + $recordPath)
}
if ($Seconds -gt 0) { $arguments += ('--time-limit=' + $Seconds) }
& $mirror @arguments
if ($LASTEXITCODE -ne 0) { throw 'USB mirroring stopped with an error.' }
