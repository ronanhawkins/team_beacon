param([string]$IpAddress = '')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (!$IpAddress) {
  $IpAddress = (& node --input-type=module -e 'import os from "node:os"; const nic=Object.entries(os.networkInterfaces()).find(([name])=>/wi-?fi|wireless/i.test(name)); console.log(nic?.[1].find(a=>a.family==="IPv4"&&!a.internal)?.address||"")').Trim()
}
$parsedIp = $null
if (![System.Net.IPAddress]::TryParse($IpAddress, [ref]$parsedIp) -or $parsedIp.AddressFamily -ne 'InterNetwork') {
  throw 'No Wi-Fi IPv4 address found. Connect Wi-Fi or run this script with -IpAddress followed by the laptop address.'
}
$opensslCommand = Get-Command openssl -ErrorAction SilentlyContinue
$openssl = if ($opensslCommand) { $opensslCommand.Source } else { 'C:\Program Files\Git\usr\bin\openssl.exe' }
if (!(Test-Path -LiteralPath $openssl)) { throw 'OpenSSL is needed to create the local HTTPS certificate. Install Git for Windows or put OpenSSL on PATH.' }
New-Item -ItemType Directory -Path relay/certs -Force | Out-Null
$valid = (Test-Path -LiteralPath relay/certs/cert.pem) -and (Test-Path -LiteralPath relay/certs/key.pem)
if ($valid) {
  & $openssl x509 -in relay/certs/cert.pem -noout -checkip $IpAddress | Out-Null
  $valid = $LASTEXITCODE -eq 0
  if ($valid) { & $openssl x509 -in relay/certs/cert.pem -noout -checkend 86400 | Out-Null; $valid = $LASTEXITCODE -eq 0 }
}
if (!$valid) {
  & $openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 -keyout relay/certs/key.pem -out relay/certs/cert.pem -subj '/CN=Beacon local demo' -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$IpAddress"
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local development certificate.' }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'The headset build failed.' }
Write-Host "`nQuest Browser: https://${IpAddress}:8443/headset/"
Write-Host 'Laptop controls: http://127.0.0.1:5174/hub/'
Write-Host 'Same Wi-Fi on both devices. Accept the local certificate warning in Quest Browser, then Enter AR.'
Write-Host 'Keep this window open. Stop any earlier laptop demo before starting this one.'
$env:RELAY_HOST = $IpAddress
& node relay/server.js --wifi
