<#
  One-time IIS setup for the sales dashboard test deployment.
  MUST be run in an elevated PowerShell ("Run as administrator"):

    powershell -ExecutionPolicy Bypass -File D:\Lavkush\salesDashborad\setup-iis.ps1

  1. Enables the ARR proxy, so IIS can forward /api to the API (127.0.0.1:8787).
  2. Copies web.config into the site folder (the /api forward + page links).
  3. Starts the IIS site "salesdashboard" (192.168.3.142:8085).
  4. Registers the API to start with Windows (scheduled task, runs as SYSTEM).
  5. Checks the dashboard and the API through IIS.
#>
$site = 'salesdashboard'
$siteDir = 'C:\inetpub\wwwroot\salesdashboard\dist'
$webConfig = Join-Path $PSScriptRoot 'divperf-web\dist\web.config'
$appcmd = "$env:windir\system32\inetsrv\appcmd.exe"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'This window is NOT running as administrator.' -ForegroundColor Red
  Write-Host 'Close it, right-click Windows PowerShell, choose "Run as administrator", click Yes, and run this again.'
  exit 1
}

Write-Host '1. Enabling the ARR proxy...'
& $appcmd set config -section:system.webServer/proxy /enabled:"True" /commit:apphost

Write-Host '2. Copying web.config...'
Copy-Item $webConfig (Join-Path $siteDir 'web.config') -Force
Write-Host "   copied to $siteDir"

Write-Host "3. Starting the IIS site '$site'..."
& $appcmd list site /name:$site
& $appcmd start site /site.name:$site

Write-Host '4. Registering the API to start with Windows...'
# Keeping the API running is set up by setup-api-autostart.ps1.

Write-Host '5. Checking...'
Start-Sleep -Seconds 2
foreach ($u in 'http://192.168.3.142:8085/', 'http://192.168.3.142:8085/division', 'http://192.168.3.142:8085/api/health') {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 10
    Write-Host ("   OK   {0} -> {1}" -f $u, $r.StatusCode) -ForegroundColor Green
  } catch {
    Write-Host ("   FAIL {0} -> {1}" -f $u, $_.Exception.Message) -ForegroundColor Red
  }
}
