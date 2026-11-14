param([string]$Editor = 'C:\Program Files\Unity\Hub\Editor\6000.3.28f1\Editor\Unity.exe', [switch]$UseSourceProject)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$sourceProject = Join-Path $repo 'apps\quest'
$logs = Join-Path $repo '.local'
if (!(Test-Path -LiteralPath $Editor)) { throw 'Install Unity 6000.3.28f1 with Android Build Support, or supply -Editor.' }
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$project = $sourceProject
if (!$UseSourceProject) {
    # Keep build caches in a disposable working folder. This also avoids Windows
    # holding open package directories in the source project during imports.
    $project = [IO.Path]::GetFullPath((Join-Path $logs 'quest-build'))
    New-Item -ItemType Directory -Path $project -Force | Out-Null
    foreach ($folder in @('Assets', 'Packages', 'ProjectSettings')) {
        $destination = [IO.Path]::GetFullPath((Join-Path $project $folder))
        if (!$destination.StartsWith($project + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected build-copy path.' }
        # Only these three generated copies are mirrored; Library and source stay intact.
        & robocopy (Join-Path $sourceProject $folder) $destination /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -ge 8) { throw ('Could not copy ' + $folder + ' into the build folder.') }
    }
}
foreach ($stage in @(
    @{ Method = 'BeaconBuild.Prepare'; Name = 'prepare'; Marker = 'BEACON_PREPARED' },
    @{ Method = 'BeaconVerify.Run'; Name = 'verify'; Marker = 'BEACON_CHECKS_PASSED' },
    @{ Method = 'BeaconBuild.BuildAndroid'; Name = 'build'; Marker = 'BEACON_APK_READY' }
)) {
    $log = Join-Path $logs ('unity-' + $stage.Name + '.log')
    Write-Host ('Unity: ' + $stage.Name + ' (log: ' + $log + ')')
    $arguments = @('-batchmode', '-nographics', '-projectPath', ('"' + $project + '"'), '-buildTarget', 'Android',
        '-executeMethod', $stage.Method, '-accept-apiupdate', '-quit', '-logFile', ('"' + $log + '"'))
    $process = Start-Process -FilePath $Editor -ArgumentList $arguments -WorkingDirectory $project -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0 -or !(Select-String -LiteralPath $log -SimpleMatch $stage.Marker -Quiet)) {
        Get-Content -LiteralPath $log -Tail 35
        throw ('Unity ' + $stage.Name + ' failed. Full log: ' + $log)
    }
}
if (!$UseSourceProject) {
    $builds = Join-Path $sourceProject 'Builds'
    New-Item -ItemType Directory -Path $builds -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $project 'Builds\BeaconAR.apk') -Destination (Join-Path $builds 'BeaconAR.apk') -Force
    # Bring back generated scene, XR settings, fonts and GUID metadata. Source
    # scripts are never overwritten by the working copy.
    $generated = @('Assets\Beacon\Scenes', 'Assets\XR', 'Assets\Resources', 'Assets\Oculus', 'Assets\CompositionLayers', 'Assets\TextMesh Pro', 'ProjectSettings')
    foreach ($relative in $generated) {
        $from = Join-Path $project $relative; $to = Join-Path $sourceProject $relative
        if (Test-Path -LiteralPath $from) {
            New-Item -ItemType Directory -Path $to -Force | Out-Null
            Get-ChildItem -LiteralPath $from -Force | Copy-Item -Destination $to -Recurse -Force
        }
    }
    Get-ChildItem -LiteralPath (Join-Path $project 'Assets') -Filter '*.meta' -Recurse | ForEach-Object {
        $relative = $_.FullName.Substring($project.Length + 1); $to = Join-Path $sourceProject $relative
        $asset = $to.Substring(0, $to.Length - 5)
        if ((Test-Path -LiteralPath $asset) -and !(Test-Path -LiteralPath $to)) { Copy-Item -LiteralPath $_.FullName -Destination $to }
    }
    Copy-Item -LiteralPath (Join-Path $project 'Packages\packages-lock.json') -Destination (Join-Path $sourceProject 'Packages\packages-lock.json') -Force
}
Write-Host 'Ready: apps/quest/Builds/BeaconAR.apk. Run Install Native Quest.cmd with the Quest connected.'
