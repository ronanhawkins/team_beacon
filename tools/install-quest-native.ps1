param([string]$Serial = '', [switch]$LaunchOnly, [ValidateSet('jezero','gale')][string]$Site='jezero')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $repo '.local\platform-tools\adb.exe'
$apk = Join-Path $repo 'apps\quest\Builds\BeaconAR.apk'
if (!$LaunchOnly -and !(Test-Path -LiteralPath $apk)) { throw 'Build the native Beacon AR APK in Unity first.' }
if (!(Test-Path -LiteralPath $adb)) { throw 'Android platform tools are missing from .local\platform-tools.' }
$devices = @(& $adb devices | Where-Object { $_ -match '^\S+\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (!$Serial) { if ($devices.Count -ne 1) { throw 'Connect one Quest and accept USB debugging, or supply -Serial.' }; $Serial = $devices[0] }
if ($Serial -notin $devices) { throw 'Quest is not connected or USB debugging has not been allowed.' }
$model = (& $adb -s $Serial shell getprop ro.product.model).Trim()
if ($model -notmatch 'Quest') { throw 'Selected device is not a Quest.' }
$startRelay=$false
try {
    $session = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/session.json' -TimeoutSec 3
    $metadata = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/data/site.json' -TimeoutSec 3
    $startRelay=$metadata.site -notmatch $Site -or $session.capabilities.commandReplies -ne $true
}
catch {$startRelay=$true}
if($startRelay) {
    $listener=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if($listener) {
        $existing=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$listener.OwningProcess)
        if($existing.Name -ne 'node.exe' -or $existing.CommandLine -notmatch 'relay[\\/]server\.js.*--local') {throw 'A different service is using the mission port. Close it before starting Beacon.'}
        Stop-Process -Id $existing.ProcessId
    }
    $node = (Get-Command node -ErrorAction Stop).Source
    $logs = Join-Path $repo '.local'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $relayArgs=@('relay/server.js','--local');if($Site -eq 'jezero') {$relayArgs+=@('--site','jezero')}
    Start-Process -FilePath $node -ArgumentList $relayArgs -WorkingDirectory $repo -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'native-relay.log') -RedirectStandardError (Join-Path $logs 'native-relay-error.log') | Out-Null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { $session = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/session.json' -TimeoutSec 2; break } catch { }
    }
}
if ($session.version -ne 1 -or !$session.waypoints) { throw 'The laptop mission relay did not start. Check .local/native-relay-error.log.' }
$metadata = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/data/site.json' -TimeoutSec 3
if($metadata.site -notmatch $Site) {throw 'The relay is serving the wrong mission site.'}
& $adb -s $Serial reverse tcp:5174 tcp:5174
if ($LASTEXITCODE -ne 0) { throw 'USB data connection failed.' }
if (!$LaunchOnly) {
    & $adb -s $Serial install -r $apk
    if ($LASTEXITCODE -ne 0) { throw 'Native app installation failed.' }
    Write-Host 'Beacon AR is installed.'
}
$power = & $adb -s $Serial shell dumpsys power
if ($LASTEXITCODE -ne 0) { throw 'Could not check whether the Quest is awake.' }
if (($power -join "`n") -notmatch 'mWakefulness=Awake\b') {
    Write-Warning 'The Quest is asleep; Beacon has not been opened. Put on the headset, then run Start Native Quest.cmd.'
    return
}
# Quest can leave `am start -W` waiting indefinitely behind an OS dialog.
# Submit the launch, then use the bounded process/relay check below.
$launch = & $adb -s $Serial shell am start --user current -n com.teambeacon.ar/com.unity3d.player.UnityPlayerGameActivity
if ($LASTEXITCODE -ne 0 -or ($launch -join "`n") -match '(?im)^Error|Exception') {
    $launch | Write-Host
    throw 'The Quest did not open Beacon AR. Keep it awake and try Start Native Quest.cmd again.'
}
# A successful launch request alone does not prove Unity actually started.
# Wait for both the native process and its existing relay handshake.
$connected = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $appProcess = & $adb -s $Serial shell pidof com.teambeacon.ar
    if ($LASTEXITCODE -eq 0 -and $appProcess) {
        try {
            $clients = @(Invoke-RestMethod -Uri 'http://127.0.0.1:5174/clients' -TimeoutSec 2)
            if (@($clients | Where-Object { $_.role -eq 'headset-unity' }).Count -gt 0) { $connected = $true; break }
        } catch { }
    }
    Start-Sleep -Milliseconds 500
}
if (!$connected) { throw 'Beacon has not connected. Finish or dismiss any system prompt inside the headset, keep it awake, then run Start Native Quest.cmd again.' }
Write-Host 'Beacon AR is running and connected to the laptop mission. Keep USB connected.'
Write-Host 'Laptop control: http://127.0.0.1:5174/hub/'
