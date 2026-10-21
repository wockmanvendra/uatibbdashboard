<#
  Keeps the dashboard API running without anyone starting it by hand.
  Run ONCE in an elevated PowerShell ("Run as administrator"):

    powershell -ExecutionPolicy Bypass -File D:\Lavkush\salesDashborad\setup-api-autostart.ps1

  Registers the scheduled task "SalesDashboard API" (replacing any earlier one):
    - runs D:\saleddashboard_api\start-api.cmd as SYSTEM - no user needs to be signed in;
    - starts it when Windows starts;
    - checks every 5 minutes and starts it again if it has stopped (a copy that is
      already running is left alone);
    - no time limit on the run.
  Then starts it, if it is not already running.
#>
$name = 'SalesDashboard API'
$cmd = 'D:\saleddashboard_api\start-api.cmd'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'This window is NOT running as administrator.' -ForegroundColor Red
  Write-Host 'Right-click Windows PowerShell, choose "Run as administrator", and run this again.'
  exit 1
}

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`"" -WorkingDirectory 'D:\saleddashboard_api'
$atBoot = New-ScheduledTaskTrigger -AtStartup
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $name -Action $action -Trigger @($atBoot, $every5) -Settings $settings `
  -Principal $principal -Description 'Sales dashboard API on 127.0.0.1:8787 (IIS forwards /api to it).' -Force | Out-Null
Write-Host "Registered scheduled task '$name'." -ForegroundColor Green

# Hand the running API over to the task, so from now on SYSTEM owns it.
$running = Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue
foreach ($c in $running) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $name

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    if ((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2).StatusCode -eq 200) {
      Write-Host 'API is running under the scheduled task.' -ForegroundColor Green
      exit 0
    }
  } catch {}
}
Write-Host 'The API did not answer - see D:\saleddashboard_api\logs\api.log' -ForegroundColor Red
