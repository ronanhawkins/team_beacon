param([Parameter(Mandatory=$true)][string]$Serial, [ValidateSet('Left','Right','Both')][string]$Eye='Left',
    [string]$Crop='', [double]$Angle=22, [string]$Record='', [int]$Seconds=0, [switch]$Diagnostics)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$adb=Join-Path $repo '.local\platform-tools\adb.exe'
$server=Join-Path $repo '.local\scrcpy\scrcpy-win64-v5.0.1\scrcpy-server'
$player=Get-ChildItem -LiteralPath (Join-Path $repo '.local\ffmpeg') -Filter ffplay.exe -Recurse | Select-Object -First 1
if(!$player) {throw 'The local FFmpeg tools are missing. See apps/quest/README.md.'}
$ffmpeg=Join-Path $player.DirectoryName 'ffmpeg.exe'
if($Serial -notmatch '^[a-zA-Z0-9._:-]+$') {throw 'Invalid USB serial.'}
function Arguments($items) {
    ($items | ForEach-Object {if($_.ToString().Contains('"')) {throw 'Unsupported quote in process argument.'}; '"'+$_.ToString()+'"'}) -join ' '
}
function CloseOwnedProcess($process) {
    if($null -ne $process -and !$process.HasExited) {$process.Kill();$process.WaitForExit()}
}
# The headset sends its unmodified full frame. Cropping and rotation happen on
# the laptop, avoiding the Quest's cropped virtual-display capture path.
# Raw H.264 has no presentation timestamps. Supply a 30 fps clock instead of
# dropping the initial keyframe and waiting indefinitely for a displayable frame.
$filters=@('setpts=N/(30*TB)')
if($Crop) {
    if($Crop -notmatch '^(\d+):(\d+):(\d+):(\d+)$') {throw 'Crop must be width:height:x:y in the reported device dimensions.'}
    $cropValues=@($Matches[1],$Matches[2],$Matches[3],$Matches[4]) | ForEach-Object {[int]$_}
    $size=(& $adb -s $Serial shell wm size) -join "`n"
    $match=[regex]::Match($size,'Override size:\s*(\d+)x(\d+)')
    if(!$match.Success) {$match=[regex]::Match($size,'Physical size:\s*(\d+)x(\d+)')}
    if(!$match.Success) {throw 'Unable to read device dimensions.'}
    $w=[int]$match.Groups[1].Value;$h=[int]$match.Groups[2].Value
    if($cropValues[0] -le 0 -or $cropValues[1] -le 0 -or $cropValues[0]+$cropValues[2] -gt $w -or $cropValues[1]+$cropValues[3] -gt $h) {throw 'Crop is outside the device frame.'}
    $filters+=('crop=trunc(iw*{0}/{4}/2)*2:trunc(ih*{1}/{5}/2)*2:iw*{2}/{4}:ih*{3}/{5}' -f $cropValues[0],$cropValues[1],$cropValues[2],$cropValues[3],$w,$h)
} elseif($Eye -ne 'Both') {
    $offset=if($Eye -eq 'Right') {'iw/2'} else {'0'}
    $filters+=('crop=trunc(iw/4)*2:ih:'+ $offset +':0')
}
if($Angle -ne 0) {
    $radians=($Angle*[math]::PI/180).ToString('0.000000',[Globalization.CultureInfo]::InvariantCulture)
    $filters+=('rotate='+$radians+':ow=ceil(rotw('+ $radians +')/2)*2:oh=ceil(roth('+ $radians +')/2)*2:c=black')
}
$filter=if($filters.Count) {$filters -join ','} else {'null'}
$recordPath=$null
if($Record) {
    $recordPath=[IO.Path]::GetFullPath($Record)
    if(Test-Path -LiteralPath $recordPath) {throw 'Recording already exists; choose a new filename.'}
    if([IO.Path]::GetExtension($recordPath) -notin @('.mp4','.mkv')) {throw 'Use .mp4 or .mkv for a video recording.'}
}
$scid=(Get-Random -Minimum 1 -Maximum 2147483647).ToString('x8')
$socket='scrcpy_'+$scid
$deviceJar='/data/local/tmp/beacon-mirror-server.jar'
$logs=Join-Path $repo '.local'
& $adb -s $Serial push $server $deviceJar | Out-Null
if($LASTEXITCODE -ne 0) {throw 'Could not prepare USB video capture.'}
$port=(& $adb -s $Serial forward tcp:0 ('localabstract:'+$socket)).Trim()
if($LASTEXITCODE -ne 0 -or $port -notmatch '^\d+$') {throw 'Could not open the local USB video connection.'}
$capture=$null;$viewer=$null;$encoder=$null
try {
    $serverArgs=@('-s',$Serial,'shell',('CLASSPATH='+$deviceJar),'app_process','/','com.genymobile.scrcpy.Server','5.0.1',
        ('scid='+$scid),'tunnel_forward=true','audio=false','control=false','cleanup=false','raw_stream=true','max_size=1920','max_fps=30','video_bit_rate=8000000','video_codec_options=i-frame-interval=1','log_level=info')
    $capture=Start-Process -FilePath $adb -ArgumentList (Arguments $serverArgs) -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logs 'quest-client-capture.log') -RedirectStandardError (Join-Path $logs 'quest-client-capture-error.log')
    $ready=$false
    for($attempt=0;$attempt -lt 40;$attempt++) {
        if($capture.HasExited) {throw 'Quest video capture could not start; see .local/quest-client-capture-error.log.'}
        $sockets=& $adb -s $Serial shell cat /proc/net/unix
        if($sockets -match $socket) {$ready=$true;break}
        Start-Sleep -Milliseconds 150
    }
    if(!$ready) {throw 'Quest video capture did not become ready.'}
    $inputUrl='tcp://127.0.0.1:'+$port
    $level=if($Diagnostics) {'info'} else {'warning'}
    $viewerArgs=@('-hide_banner','-loglevel',$level,'-fflags','+genpts','-flags','low_delay','-probesize','65536','-analyzeduration','100000','-sync','video','-framedrop','-an','-autoexit','-window_title','Beacon Quest Demo','-x','800','-y','850')
    if(!$recordPath) {
        $viewerArgs+=@('-vf',$filter,'-f','h264','-framerate','30','-i',$inputUrl)
        $viewer=Start-Process -FilePath $player.FullName -ArgumentList (Arguments $viewerArgs) -WindowStyle Normal -PassThru `
            -RedirectStandardOutput (Join-Path $logs 'quest-client-view.log') -RedirectStandardError (Join-Path $logs 'quest-client-view-error.log')
    } else {
        # Filter once, encode the recording, and pipe an uncompressed preview to
        # ffplay. Both outputs contain the same one-eye image; no microphone.
        $viewerArgs+=@('-f','nut','-i','pipe:0')
        $viewInfo=New-Object Diagnostics.ProcessStartInfo
        $viewInfo.FileName=$player.FullName;$viewInfo.Arguments=Arguments $viewerArgs;$viewInfo.UseShellExecute=$false;$viewInfo.CreateNoWindow=$true
        $viewInfo.RedirectStandardInput=$true;$viewInfo.RedirectStandardError=$true
        $viewer=[Diagnostics.Process]::Start($viewInfo);$viewErrors=$viewer.StandardError.ReadToEndAsync()
        $encodeArgs=@('-hide_banner','-loglevel','warning','-n','-fflags','+genpts','-flags','low_delay','-probesize','65536','-analyzeduration','100000','-f','h264','-framerate','30','-i',$inputUrl,
            '-filter_complex',('[0:v]'+$filter+',split=2[save][preview]'),'-map','[save]','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p',$recordPath,
            '-map','[preview]','-c:v','rawvideo','-f','nut','pipe:1')
        $encodeInfo=New-Object Diagnostics.ProcessStartInfo
        $encodeInfo.FileName=$ffmpeg;$encodeInfo.Arguments=Arguments $encodeArgs;$encodeInfo.UseShellExecute=$false;$encodeInfo.CreateNoWindow=$true
        $encodeInfo.RedirectStandardInput=$true;$encodeInfo.RedirectStandardOutput=$true;$encodeInfo.RedirectStandardError=$true
        $encoder=[Diagnostics.Process]::Start($encodeInfo);$encodeErrors=$encoder.StandardError.ReadToEndAsync()
        $copy=$encoder.StandardOutput.BaseStream.CopyToAsync($viewer.StandardInput.BaseStream)
    }
    Write-Host ('Laptop-side '+$Eye.ToLowerInvariant()+'-eye mirror is open. Keep the Quest awake. Close the video window to stop.')
    @{viewer=$viewer.Id;capture=$capture.Id;port=$port;eye=$Eye;angle=$Angle;record=$recordPath} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'quest-client-mirror.json')
    $timer=[Diagnostics.Stopwatch]::StartNew()
    while(!$viewer.HasExited -and !$capture.HasExited -and ($Seconds -le 0 -or $timer.Elapsed.TotalSeconds -lt $Seconds)) {
        if($encoder -and $encoder.HasExited) {break}
        Start-Sleep -Milliseconds 200
    }
    if($encoder -and !$encoder.HasExited) {$encoder.StandardInput.WriteLine('q');if(!$encoder.WaitForExit(10000)) {throw 'Video recording did not finish cleanly.'}}
    if($encoder) {
        $encodeErrors.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $logs 'quest-client-record-error.log')
        if($encoder.ExitCode -ne 0) {throw 'Recording failed; see .local/quest-client-record-error.log.'}
    }
    if($viewer.HasExited -and $viewer.ExitCode -ne 0) {throw 'Video playback failed; see .local/quest-client-view-error.log.'}
} finally {
    CloseOwnedProcess $viewer;CloseOwnedProcess $encoder;CloseOwnedProcess $capture
    & $adb -s $Serial forward --remove ('tcp:'+$port) | Out-Null
}
