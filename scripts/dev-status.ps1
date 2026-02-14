param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [string]$RelayBase = "http://127.0.0.1:8787",
  [switch]$IncludeLogs,
  [int]$LogTailLines = 30
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $RepoPath

$pidFile = Join-Path $RepoPath "tmp\logs\stack-pids.json"
$relayOutLog = Join-Path $RepoPath "tmp\logs\relay-dev.out.log"
$relayErrLog = Join-Path $RepoPath "tmp\logs\relay-dev.err.log"
$agentOutLog = Join-Path $RepoPath "tmp\logs\agent-dev.out.log"
$agentErrLog = Join-Path $RepoPath "tmp\logs\agent-dev.err.log"

$adminToken = [Environment]::GetEnvironmentVariable("RELAY_ADMIN_TOKEN", "Process")
if ([string]::IsNullOrWhiteSpace($adminToken) -and (Test-Path ".env.test")) {
  Get-Content ".env.test" | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $pair = $line -split "=", 2
    if ($pair.Count -eq 2 -and $pair[0] -eq "RELAY_ADMIN_TOKEN") {
      $adminToken = $pair[1]
    }
  }
}

$stack = $null
if (Test-Path $pidFile) {
  $raw = Get-Content $pidFile -Raw
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    $stack = $raw | ConvertFrom-Json
  }
}

function Get-ProcState {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return "unknown" }
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return "exited" }
  return "running"
}

function Try-JsonGet {
  param(
    [string]$Url,
    [hashtable]$Headers
  )
  try {
    return Invoke-RestMethod -Uri $Url -Method Get -Headers $Headers -TimeoutSec 3
  } catch {
    return $null
  }
}

$relayPid = if ($null -ne $stack) { [int]$stack.relayPid } else { 0 }
$agentPid = if ($null -ne $stack) { [int]$stack.agentPid } else { 0 }
$headers = @{}
if (-not [string]::IsNullOrWhiteSpace($adminToken)) {
  $headers["x-admin-token"] = $adminToken
}

$health = Try-JsonGet -Url "$RelayBase/healthz" -Headers @{}
$ops = Try-JsonGet -Url "$RelayBase/ops/config" -Headers $headers
$metrics = Try-JsonGet -Url "$RelayBase/metrics" -Headers $headers
$machines = Try-JsonGet -Url "$RelayBase/machines" -Headers $headers

$report = [pscustomobject]@{
  checkedAt = (Get-Date).ToString("o")
  relayBase = $RelayBase
  pidFile = @{
    path = $pidFile
    exists = (Test-Path $pidFile)
    relayPid = $relayPid
    relayState = Get-ProcState -ProcessId $relayPid
    agentPid = $agentPid
    agentState = Get-ProcState -ProcessId $agentPid
  }
  endpoints = @{
    health = $health
    store = if ($null -ne $ops) { $ops.store } else { $null }
    metricsStore = if ($null -ne $metrics) { $metrics.store } else { $null }
    machineCount = if ($null -ne $machines -and $null -ne $machines.items) { $machines.items.Count } else { $null }
  }
  logs = @{
    relayOutPath = $relayOutLog
    relayErrPath = $relayErrLog
    agentOutPath = $agentOutLog
    agentErrPath = $agentErrLog
    relayOut = if ($IncludeLogs -and (Test-Path $relayOutLog)) { Get-Content $relayOutLog -Tail $LogTailLines } else { @() }
    relayErr = if ($IncludeLogs -and (Test-Path $relayErrLog)) { Get-Content $relayErrLog -Tail $LogTailLines } else { @() }
    agentOut = if ($IncludeLogs -and (Test-Path $agentOutLog)) { Get-Content $agentOutLog -Tail $LogTailLines } else { @() }
    agentErr = if ($IncludeLogs -and (Test-Path $agentErrLog)) { Get-Content $agentErrLog -Tail $LogTailLines } else { @() }
  }
}

$report | ConvertTo-Json -Depth 10
