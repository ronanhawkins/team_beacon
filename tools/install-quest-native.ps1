param([string]$Serial = '')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $repo '.local\platform-tools\adb.exe'
$apk = Join-Path $repo 'apps\quest\Builds\BeaconAR.apk'
if (!(Test-Path -LiteralPath $apk)) { throw 'Build the native Beacon AR APK in Unity first.' }
if (!(Test-Path -LiteralPath $adb)) { throw 'Android platform tools are missing from .local\platform-tools.' }
$devices = @(& $adb devices | Where-Object { $_ -match '^\S+\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (!$Serial) { if ($devices.Count -ne 1) { throw 'Connect one Quest and accept USB debugging, or supply -Serial.' }; $Serial = $devices[0] }
if ($Serial -notin $devices) { throw 'Quest is not connected or USB debugging has not been allowed.' }
$model = (& $adb -s $Serial shell getprop ro.product.model).Trim()
if ($model -notmatch 'Quest') { throw 'Selected device is not a Quest.' }
try { $session = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/session.json' -TimeoutSec 3 }
catch {
    $node = (Get-Command node -ErrorAction Stop).Source
    $logs = Join-Path $repo '.local'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    Start-Process -FilePath $node -ArgumentList @('relay/server.js', '--local') -WorkingDirectory $repo -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'native-relay.log') -RedirectStandardError (Join-Path $logs 'native-relay-error.log') | Out-Null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { $session = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/session.json' -TimeoutSec 2; break } catch { }
    }
}
if ($session.version -ne 1 -or !$session.waypoints) { throw 'The laptop mission relay did not start. Check .local/native-relay-error.log.' }
& $adb -s $Serial reverse tcp:5174 tcp:5174
if ($LASTEXITCODE -ne 0) { throw 'USB data connection failed.' }
& $adb -s $Serial install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'Native app installation failed.' }
& $adb -s $Serial shell monkey -p com.teambeacon.ar -c android.intent.category.LAUNCHER 1
if ($LASTEXITCODE -ne 0) { throw 'Launch Beacon AR from Unknown Sources in the headset.' }
Write-Host 'Beacon AR is installed and launched. Keep USB connected for the shared mission data.'
Write-Host 'Laptop control: http://127.0.0.1:5174/hub/'
