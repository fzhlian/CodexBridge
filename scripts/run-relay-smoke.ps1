param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [bool]$ForceMemoryStore = $true,
  [int]$StartupTimeoutSec = 60
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $RepoPath

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

if (Test-Path ".env.test") {
  Import-EnvFileAsFallback -Path ".env.test"
} else {
  Write-Host ".env.test not found, using process/user environment variables only."
}

if ($ForceMemoryStore) {
  [Environment]::SetEnvironmentVariable("STORE_MODE", "memory", "Process")
  [Environment]::SetEnvironmentVariable("AUDIT_INDEX_MODE", "memory", "Process")
}

$relayJob = Start-Job -ArgumentList $RepoPath, [bool]$ForceMemoryStore -ScriptBlock {
  param(
    [string]$RepoPathArg,
    [bool]$ForceMemoryStoreArg
  )
  Set-Location -LiteralPath $RepoPathArg
  & powershell -ExecutionPolicy Bypass -File ".\scripts\fix-terminal-env.ps1" | Out-Null
  if (Test-Path ".env.test") {
    Get-Content ".env.test" | ForEach-Object {
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
        [Environment]::SetEnvironmentVariable($key, $value, "Process")
      }
    }
  }
  if ($ForceMemoryStoreArg) {
    [Environment]::SetEnvironmentVariable("STORE_MODE", "memory", "Process")
    [Environment]::SetEnvironmentVariable("AUDIT_INDEX_MODE", "memory", "Process")
  }
  pnpm --filter @codexbridge/relay-server run dev
}

$agentJob = Start-Job -ArgumentList $RepoPath, [bool]$ForceMemoryStore -ScriptBlock {
  param(
    [string]$RepoPathArg,
    [bool]$ForceMemoryStoreArg
  )
  Set-Location -LiteralPath $RepoPathArg
  & powershell -ExecutionPolicy Bypass -File ".\scripts\fix-terminal-env.ps1" | Out-Null
  if (Test-Path ".env.test") {
    Get-Content ".env.test" | ForEach-Object {
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
        [Environment]::SetEnvironmentVariable($key, $value, "Process")
      }
    }
  }
  if ($ForceMemoryStoreArg) {
    [Environment]::SetEnvironmentVariable("STORE_MODE", "memory", "Process")
    [Environment]::SetEnvironmentVariable("AUDIT_INDEX_MODE", "memory", "Process")
  }
  pnpm --filter ./packages/vscode-agent run dev:node
}

try {
  $health = $null
  $started = $false
  for ($i = 0; $i -lt $StartupTimeoutSec; $i += 2) {
    Start-Sleep -Seconds 2
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/healthz" -Method Get -TimeoutSec 2
      $started = $true
      break
    } catch {
      continue
    }
  }
  if (-not $started) {
    Write-Error "relay startup timeout after $StartupTimeoutSec seconds"
    Write-Host "relay job output:"
    Receive-Job -Job $relayJob -Keep | Select-Object -First 120
    Write-Host "agent job output:"
    Receive-Job -Job $agentJob -Keep | Select-Object -First 120
    throw "relay not reachable"
  }
  $headers = @{ "x-admin-token" = "dev-admin-token" }
  $ops = Invoke-RestMethod -Uri "http://127.0.0.1:8787/ops/config" -Headers $headers -Method Get
  $metricsBefore = Invoke-RestMethod -Uri "http://127.0.0.1:8787/metrics" -Headers $headers -Method Get
  $machines = Invoke-RestMethod -Uri "http://127.0.0.1:8787/machines" -Headers $headers -Method Get
  $inflightBefore = Invoke-RestMethod -Uri "http://127.0.0.1:8787/inflight" -Headers $headers -Method Get
  $auditBefore = Invoke-RestMethod -Uri "http://127.0.0.1:8787/audit/recent?limit=5" -Headers $headers -Method Get

  & powershell -ExecutionPolicy Bypass -File ".\scripts\demo-flow.ps1" -RelayBase "http://127.0.0.1:8787" -UserId "u1" -MachineId "dev-machine-1" | Out-Null
  Start-Sleep -Seconds 2

  $metricsAfter = Invoke-RestMethod -Uri "http://127.0.0.1:8787/metrics" -Headers $headers -Method Get
  $inflightAfter = Invoke-RestMethod -Uri "http://127.0.0.1:8787/inflight" -Headers $headers -Method Get
  $auditAfter = Invoke-RestMethod -Uri "http://127.0.0.1:8787/audit/recent?limit=5" -Headers $headers -Method Get

  [pscustomobject]@{
    health = $health
    store = $ops.store
    metricsBefore = $metricsBefore
    metricsAfter = $metricsAfter
    machines = $machines
    inflightBefore = $inflightBefore
    inflightAfter = $inflightAfter
    auditBefore = $auditBefore
    auditAfter = $auditAfter
    relayJobState = $relayJob.State
    agentJobState = $agentJob.State
  } | ConvertTo-Json -Depth 10
} finally {
  Stop-Job $relayJob -ErrorAction SilentlyContinue
  Stop-Job $agentJob -ErrorAction SilentlyContinue
  Remove-Job $relayJob -Force -ErrorAction SilentlyContinue
  Remove-Job $agentJob -Force -ErrorAction SilentlyContinue
}
