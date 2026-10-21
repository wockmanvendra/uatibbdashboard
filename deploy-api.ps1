<#
  Deploys the dashboard API to D:\saleddashboard_api and (re)starts it.
  For the test deployment on this server; the frontend is served by IIS
  (site "salesdashboard", C:\inetpub\wwwroot\salesdashboard\dist), which
  forwards /api to this API on 127.0.0.1:8787 - see divperf-web\public\web.config.

    powershell -ExecutionPolicy Bypass -File .\deploy-api.ps1

  Steps: build -> stop the running API -> copy the build -> install runtime
  packages -> start it hidden -> wait for /health.

  The deployed .env (D:\saleddashboard_api\.env) is copied from divperf-api\.env
  on the FIRST deploy only; edit it there afterwards - redeploys keep it.
  Logs: D:\saleddashboard_api\logs\api.log

  The API is kept running by the scheduled task "SalesDashboard API" (SYSTEM, at
  boot and re-checked every 5 minutes) - set up once with setup-api-autostart.ps1.
#>
param([string]$Target = 'D:\saleddashboard_api')

$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'divperf-api'
$node = (Get-Command node).Source

Write-Host 'Building the API...'
Push-Location $src
try {
  npm run build --silent | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "API build failed (exit $LASTEXITCODE)." }
} finally { Pop-Location }

Write-Host 'Stopping the running API...'
$ids = @(Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess)
# A dev watcher (npm run dev) would restart it, so stop that too.
$ids += Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'divperf-api\\node_modules\\.*tsx' } |
  Select-Object -ExpandProperty ProcessId
foreach ($id in ($ids | Where-Object { $_ } | Sort-Object -Unique)) {
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

Write-Host "Copying to $Target..."
New-Item -ItemType Directory -Force -Path $Target, (Join-Path $Target 'logs') | Out-Null
robocopy (Join-Path $src 'dist') (Join-Path $Target 'dist') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the build failed (robocopy exit $LASTEXITCODE)." }
Copy-Item (Join-Path $src 'package.json'), (Join-Path $src 'package-lock.json') $Target -Force
if (-not (Test-Path (Join-Path $Target '.env'))) {
  Copy-Item (Join-Path $src '.env') (Join-Path $Target '.env')
  Write-Host 'Copied .env (first deploy). Later deploys keep the deployed one.'
}

Write-Host 'Installing runtime packages...'
Push-Location $Target
try {
  npm ci --omit=dev --no-audit --no-fund | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)." }
} finally { Pop-Location }

# The start script names node.exe by full path, so it also works from a
# scheduled task that has no PATH.
Set-Content -Path (Join-Path $Target 'start-api.cmd') -Encoding ascii -Value @(
  '@echo off',
  'rem Starts the sales dashboard API. Written by deploy-api.ps1.',
  'cd /d "%~dp0"',
  'if not exist logs mkdir logs',
  "`"$node`" --env-file-if-exists=.env dist\src\server.js >> logs\api.log 2>&1"
)

Write-Host 'Starting the API...'
# Through the scheduled task when allowed, so SYSTEM owns the process; otherwise
# directly - the task's 5-minute check takes over if this copy ever stops.
# A non-elevated window may not run the SYSTEM task ("Access is denied"): that
# must not stop the script under ErrorActionPreference Stop.
$ErrorActionPreference = 'Continue'
schtasks /run /tn 'SalesDashboard API' 2>&1 | Out-Null
$ran = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if (-not $ran) {
  Start-Process -FilePath (Join-Path $Target 'start-api.cmd') -WorkingDirectory $Target -WindowStyle Hidden
}
for ($i = 0; $i -lt 60; $i++) {
  try {
    if ((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 3).StatusCode -eq 200) {
      Write-Host 'API is up on 127.0.0.1:8787.'
      exit 0
    }
  } catch {}
  Start-Sleep -Seconds 1
}
throw "The API did not answer on 127.0.0.1:8787 - see $Target\logs\api.log."
