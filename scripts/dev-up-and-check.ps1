param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [ValidateSet("redis", "memory")]
  [string]$StoreMode = "redis",
  [switch]$ShowWindows,
  [switch]$RunDemoFlow,
  [switch]$RequireMachineOnline,
  [int]$StartupTimeoutSec = 90,
  [int]$MachineWaitTimeoutSec = 45,
  [string]$UserId = "u1",
  [string]$MachineId = "dev-machine-1",
  [string]$ReportPath = ".\tmp\dev-up-report.json"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $RepoPath
Write-Host "[dev-up] repo: $RepoPath"

function Invoke-JsonGet {
  param(
    [string]$Url,
    [hashtable]$Headers = @{},
    [int]$TimeoutSec = 5,
    [switch]$AllowFailure
  )

  $args = @("-sS", "-f", "--max-time", "$TimeoutSec")
  foreach ($key in $Headers.Keys) {
    $args += @("-H", "${key}: $($Headers[$key])")
  }
  $args += $Url

  $raw = & curl.exe @args 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
    if ($AllowFailure) { return $null }
    throw "GET failed: $Url (curl exit $LASTEXITCODE)"
  }

  try {
    return ($raw | ConvertFrom-Json)
  } catch {
    if ($AllowFailure) { return $null }
    throw "Invalid JSON response: $Url"
  }
}

if (-not (Test-Path ".env.test")) {
  throw ".env.test not found. Run scripts/bootstrap-test-env.ps1 first."
}

& powershell -ExecutionPolicy Bypass -File ".\scripts\fix-terminal-env.ps1" | Out-Null
Write-Host "[dev-up] terminal env fixed"

Get-Content ".env.test" | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $pair = $line -split "=", 2
  if ($pair.Count -eq 2) {
    [Environment]::SetEnvironmentVariable($pair[0], $pair[1], "Process")
  }
}

$ensureRedis = $StoreMode -eq "redis"
$forceMemoryStore = $StoreMode -eq "memory"
$showWindows = [bool]$ShowWindows
$logDir = Join-Path $RepoPath "tmp\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$relayOutLog = Join-Path $logDir "relay-dev.out.log"
$relayErrLog = Join-Path $logDir "relay-dev.err.log"
$agentOutLog = Join-Path $logDir "agent-dev.out.log"
$agentErrLog = Join-Path $logDir "agent-dev.err.log"
$pidFile = Join-Path $logDir "stack-pids.json"

if ($ensureRedis) {
  Write-Host "[dev-up] starting redis via docker compose"
  docker compose -f docker-compose.dev.yml up -d | Out-Null 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[dev-up] docker compose failed, trying Docker Desktop recovery"
    & powershell -ExecutionPolicy Bypass -File ".\scripts\ensure-docker-desktop.ps1" -TimeoutSec 120
    docker compose -f docker-compose.dev.yml up -d | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose failed after Docker Desktop recovery attempt"
    }
  }
}

if (Test-Path $pidFile) {
  & powershell -ExecutionPolicy Bypass -File ".\scripts\stop-test-stack.ps1" -RepoPath $RepoPath -KillRelayPort | Out-Null
} else {
  & powershell -ExecutionPolicy Bypass -File ".\scripts\stop-test-stack.ps1" -RepoPath $RepoPath -KillRelayPort | Out-Null
}

$workerScript = Join-Path $RepoPath "scripts\start-stack-worker.ps1"
$relayArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $workerScript, "-RepoPath", $RepoPath, "-Role", "relay")
$agentArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $workerScript, "-RepoPath", $RepoPath, "-Role", "agent")
if ($forceMemoryStore) {
  $relayArgs += "-ForceMemoryStore"
  $agentArgs += "-ForceMemoryStore"
}

if ($showWindows) {
  $relayProc = Start-Process powershell -PassThru `
    -RedirectStandardOutput $relayOutLog -RedirectStandardError $relayErrLog `
    -ArgumentList $relayArgs
} else {
  $relayProc = Start-Process powershell -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $relayOutLog -RedirectStandardError $relayErrLog `
    -ArgumentList $relayArgs
}

$health = $null
$ready = $false
for ($i = 0; $i -lt $StartupTimeoutSec; $i += 2) {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-JsonGet -Url "http://127.0.0.1:8787/healthz" -TimeoutSec 2 -AllowFailure
    if ($health.status -eq "ok") {
      $ready = $true
      break
    }
  } catch {
    continue
  }
}
if (-not $ready) {
  Stop-Process -Id $relayProc.Id -Force -ErrorAction SilentlyContinue
  throw "relay health check timeout after $StartupTimeoutSec seconds"
}
Write-Host "[dev-up] relay health check passed"

if ($showWindows) {
  $agentProc = Start-Process powershell -PassThru `
    -RedirectStandardOutput $agentOutLog -RedirectStandardError $agentErrLog `
    -ArgumentList $agentArgs
} else {
  $agentProc = Start-Process powershell -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $agentOutLog -RedirectStandardError $agentErrLog `
    -ArgumentList $agentArgs
}
Write-Host "[dev-up] relay and agent started"
@{
  relayPid = $relayProc.Id
  agentPid = $agentProc.Id
  startedAt = (Get-Date).ToString("o")
  relayOutLog = $relayOutLog
  relayErrLog = $relayErrLog
  agentOutLog = $agentOutLog
  agentErrLog = $agentErrLog
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $pidFile

$adminToken = [Environment]::GetEnvironmentVariable("RELAY_ADMIN_TOKEN", "Process")
$headers = @{}
if (-not [string]::IsNullOrWhiteSpace($adminToken)) {
  $headers["x-admin-token"] = $adminToken
}

$machineOnline = $false
for ($i = 0; $i -lt $MachineWaitTimeoutSec; $i += 2) {
  Start-Sleep -Seconds 2
  try {
    $machinesCheck = Invoke-JsonGet -Url "http://127.0.0.1:8787/machines" -Headers $headers -TimeoutSec 2 -AllowFailure
    if (($machinesCheck.items | Where-Object { $_.machineId -eq $MachineId }).Count -gt 0) {
      $machineOnline = $true
      break
    }
  } catch {
    continue
  }
}
Write-Host "[dev-up] machine online: $machineOnline"
if ($RequireMachineOnline -and -not $machineOnline) {
  throw "target machine '$MachineId' is not online within $MachineWaitTimeoutSec seconds"
}

$ops = Invoke-JsonGet -Url "http://127.0.0.1:8787/ops/config" -Headers $headers -TimeoutSec 5
$metricsBefore = Invoke-JsonGet -Url "http://127.0.0.1:8787/metrics" -Headers $headers -TimeoutSec 5
$machinesBefore = Invoke-JsonGet -Url "http://127.0.0.1:8787/machines" -Headers $headers -TimeoutSec 5
$inflightBefore = Invoke-JsonGet -Url "http://127.0.0.1:8787/inflight" -Headers $headers -TimeoutSec 5
$auditBefore = Invoke-JsonGet -Url "http://127.0.0.1:8787/audit/recent?limit=10" -Headers $headers -TimeoutSec 5

$demoResult = $null
if ($RunDemoFlow) {
  Write-Host "[dev-up] running demo-flow"
  $demoResult = & powershell -ExecutionPolicy Bypass -File ".\scripts\demo-flow.ps1" -RelayBase "http://127.0.0.1:8787" -UserId $UserId -MachineId $MachineId
  Start-Sleep -Seconds 2
}

$metricsAfter = Invoke-JsonGet -Url "http://127.0.0.1:8787/metrics" -Headers $headers -TimeoutSec 5
$machinesAfter = Invoke-JsonGet -Url "http://127.0.0.1:8787/machines" -Headers $headers -TimeoutSec 5
$inflightAfter = Invoke-JsonGet -Url "http://127.0.0.1:8787/inflight" -Headers $headers -TimeoutSec 5
$auditAfter = Invoke-JsonGet -Url "http://127.0.0.1:8787/audit/recent?limit=10" -Headers $headers -TimeoutSec 5
$availableMachineIds = @()
if ($null -ne $machinesAfter -and $null -ne $machinesAfter.items) {
  $availableMachineIds = @($machinesAfter.items | ForEach-Object { $_.machineId })
}
if ($availableMachineIds -contains $MachineId) {
  $machineOnline = $true
}

$dockerVersion = "not_checked"
if ($ensureRedis) {
  try {
    $dockerVersion = (& cmd /c "docker --version")
  } catch {
    $dockerVersion = "unavailable"
  }
} else {
  $dockerVersion = "skipped(memory-mode)"
}

$report = [pscustomobject]@{
  checkedAt = (Get-Date).ToString("o")
  repoPath = $RepoPath
  versions = @{
    node = (node -v)
    pnpm = (pnpm -v)
    docker = $dockerVersion
  }
  store = $ops.store
  health = $health
  machineOnline = $machineOnline
  targetMachineId = $MachineId
  availableMachineIds = $availableMachineIds
  before = @{
    machines = $machinesBefore.items.Count
    inflight = $inflightBefore.items.Count
    audit = $auditBefore.items.Count
    metrics = $metricsBefore
  }
  after = @{
    machines = $machinesAfter.items.Count
    inflight = $inflightAfter.items.Count
    audit = $auditAfter.items.Count
    metrics = $metricsAfter
  }
  demoFlowRan = [bool]$RunDemoFlow
  demoFlowOutput = $demoResult
  logs = @{
    relayOut = $relayOutLog
    relayErr = $relayErrLog
    agentOut = $agentOutLog
    agentErr = $agentErrLog
    relayOutTail = @()
    relayErrTail = @()
    agentOutTail = @()
    agentErrTail = @()
  }
}

$fullReportPath = [System.IO.Path]::GetFullPath($ReportPath)
$reportDir = Split-Path -Parent $fullReportPath
if (-not [string]::IsNullOrWhiteSpace($reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}
$report | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 $fullReportPath

Write-Host "Dev stack is up. Report written to $fullReportPath"
$report | ConvertTo-Json -Depth 12
