param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [switch]$ShowWindows,
  [switch]$ForceMemoryStore,
  [switch]$SkipAgent,
  [int]$StartupTimeoutSec = 90
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $RepoPath
& powershell -ExecutionPolicy Bypass -File ".\scripts\fix-terminal-env.ps1" | Out-Null

function Import-EnvFileAsFallback {
  param([string]$Path = ".env.test")
  if (-not (Test-Path $Path)) { return }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $pair = $line -split "=", 2
    if ($pair.Count -ne 2) { return }
    $key = $pair[0]
    $value = $pair[1]
    $existingProcess = [Environment]::GetEnvironmentVariable($key, "Process")
    $existingUser = [Environment]::GetEnvironmentVariable($key, "User")
    $existingMachine = [Environment]::GetEnvironmentVariable($key, "Machine")
    if ([string]::IsNullOrWhiteSpace($existingProcess)) {
      if (-not [string]::IsNullOrWhiteSpace($existingUser)) {
        [Environment]::SetEnvironmentVariable($key, $existingUser, "Process")
        return
      }
      if (-not [string]::IsNullOrWhiteSpace($existingMachine)) {
        [Environment]::SetEnvironmentVariable($key, $existingMachine, "Process")
        return
      }
    }
    if ([string]::IsNullOrWhiteSpace($value) -or $value -eq "__SET_IN_USER_ENV__") { return }
    if ([string]::IsNullOrWhiteSpace($existingProcess) -and [string]::IsNullOrWhiteSpace($existingUser) -and [string]::IsNullOrWhiteSpace($existingMachine)) {
      [Environment]::SetEnvironmentVariable($key, $pair[1], "Process")
    }
  }
}

function Wait-RelayHealth {
  param(
    [int]$TimeoutSec = 90,
    [int]$WorkerPid = 0
  )
  for ($i = 0; $i -lt $TimeoutSec; $i += 2) {
    if ($WorkerPid -gt 0) {
      $worker = Get-Process -Id $WorkerPid -ErrorAction SilentlyContinue
      if ($null -eq $worker) {
        return @{
          ready = $false
          reason = "relay_worker_exited_early"
        }
      }
    }
    Start-Sleep -Seconds 2
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/healthz" -Method Get -TimeoutSec 2
      if ($health.status -eq "ok") {
        return @{
          ready = $true
          reason = "healthy"
        }
      }
    } catch {
      continue
    }
  }
  return @{
    ready = $false
    reason = "health_timeout"
  }
}

$logDir = Join-Path $RepoPath "tmp\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$relayOutLog = Join-Path $logDir "relay-dev.out.log"
$relayErrLog = Join-Path $logDir "relay-dev.err.log"
$agentOutLog = Join-Path $logDir "agent-dev.out.log"
$agentErrLog = Join-Path $logDir "agent-dev.err.log"
$pidFile = Join-Path $logDir "stack-pids.json"

if (Test-Path $pidFile) {
  & powershell -ExecutionPolicy Bypass -File ".\scripts\stop-test-stack.ps1" -RepoPath $RepoPath -KillRelayPort | Out-Null
} else {
  & powershell -ExecutionPolicy Bypass -File ".\scripts\stop-test-stack.ps1" -RepoPath $RepoPath -KillRelayPort | Out-Null
}

if (Test-Path ".env.test") {
  Import-EnvFileAsFallback -Path ".env.test"
} else {
  Write-Host ".env.test not found, using process/user environment variables only."
}

if ($SkipAgent) {
  Write-Host "Starting relay terminal (agent skipped)..."
} else {
  Write-Host "Starting relay and agent terminals..."
}
$workerScript = Join-Path $RepoPath "scripts\start-stack-worker.ps1"
$relayArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $workerScript, "-RepoPath", $RepoPath, "-Role", "relay")
$agentArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $workerScript, "-RepoPath", $RepoPath, "-Role", "agent")
if ($ForceMemoryStore) {
  $relayArgs += "-ForceMemoryStore"
  $agentArgs += "-ForceMemoryStore"
}

if (-not $ShowWindows) {
  $relayProc = Start-Process powershell -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $relayOutLog -RedirectStandardError $relayErrLog `
    -ArgumentList $relayArgs
} else {
  $relayProc = Start-Process powershell -PassThru `
    -RedirectStandardOutput $relayOutLog -RedirectStandardError $relayErrLog `
    -ArgumentList $relayArgs
}

$relayReady = Wait-RelayHealth -TimeoutSec $StartupTimeoutSec -WorkerPid $relayProc.Id
if (-not $relayReady.ready) {
  Stop-Process -Id $relayProc.Id -Force -ErrorAction SilentlyContinue
  $relayOutTail = if (Test-Path $relayOutLog) { Get-Content $relayOutLog -Tail 80 } else { @("relay out log not found") }
  $relayErrTail = if (Test-Path $relayErrLog) { Get-Content $relayErrLog -Tail 80 } else { @("relay err log not found") }
  $relayOutSummary = ($relayOutTail -join [Environment]::NewLine)
  $relayErrSummary = ($relayErrTail -join [Environment]::NewLine)
  throw (
    "relay start failed (reason=$($relayReady.reason)) after $StartupTimeoutSec seconds." +
    [Environment]::NewLine +
    "relayOutTail:" + [Environment]::NewLine + $relayOutSummary + [Environment]::NewLine +
    "relayErrTail:" + [Environment]::NewLine + $relayErrSummary
  )
}

if (-not $SkipAgent) {
  if (-not $ShowWindows) {
    $agentProc = Start-Process powershell -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $agentOutLog -RedirectStandardError $agentErrLog `
      -ArgumentList $agentArgs
  } else {
    $agentProc = Start-Process powershell -PassThru `
      -RedirectStandardOutput $agentOutLog -RedirectStandardError $agentErrLog `
      -ArgumentList $agentArgs
  }
}

if ($SkipAgent) {
  Write-Host "Relay started (agent skipped)."
} else {
  Write-Host "Relay and agent started."
}
Write-Host "Relay PID: $($relayProc.Id), out: $relayOutLog, err: $relayErrLog"
if ($SkipAgent) {
  Write-Host "Agent skipped: use VS Code command 'CodexBridge: Start Agent' for output-channel visibility."
} else {
  Write-Host "Agent PID: $($agentProc.Id), out: $agentOutLog, err: $agentErrLog"
}
@{
  relayPid = $relayProc.Id
  agentPid = if ($agentProc) { $agentProc.Id } else { 0 }
  startedAt = (Get-Date).ToString("o")
  relayOutLog = $relayOutLog
  relayErrLog = $relayErrLog
  agentOutLog = $agentOutLog
  agentErrLog = $agentErrLog
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $pidFile
Write-Host "PID file: $pidFile"
Write-Host "Use scripts/demo-flow.ps1 to test command flow."
