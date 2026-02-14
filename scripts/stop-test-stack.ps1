param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [switch]$KillRelayPort
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $RepoPath

function Get-RelayListenerPids {
  param([int]$Port = 8787)

  $pids = @()
  $lines = netstat -ano | Select-String "LISTENING" | Select-String ":$Port"
  foreach ($line in $lines) {
    $parts = ($line.Line.Trim() -split "\s+")
    if ($parts.Count -gt 0) {
      $candidate = $parts[-1]
      if ($candidate -match "^\d+$") {
        $pids += [int]$candidate
      }
    }
  }
  return @($pids | Sort-Object -Unique)
}

function Stop-WorkerProcesses {
  return
}

function Stop-ProcessSafely {
  param(
    [int]$ProcessId,
    [string]$Label = "process"
  )

  if ($ProcessId -le 0) {
    return
  }
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $proc) {
    return
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
  $stillAlive = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -ne $stillAlive) {
    & taskkill /PID $ProcessId /F | Out-Null
  }
  Write-Host "$Label stopped (pid=$ProcessId)"
}

$pidFile = Join-Path $RepoPath "tmp\logs\stack-pids.json"
if (-not (Test-Path $pidFile)) {
  Write-Host "No PID file found: $pidFile"
  Stop-WorkerProcesses
  if ($KillRelayPort) {
    $relayPids = Get-RelayListenerPids -Port 8787
    if ($relayPids.Count -gt 0) {
      foreach ($targetProcessId in $relayPids) {
        Stop-ProcessSafely -ProcessId $targetProcessId -Label "relay listener on 8787"
      }
    } else {
      Write-Host "No relay listener found on 8787."
    }
  }
  exit 0
}

$raw = Get-Content $pidFile -Raw
if ([string]::IsNullOrWhiteSpace($raw)) {
  Write-Host "PID file is empty: $pidFile"
  exit 0
}

$parsed = $raw | ConvertFrom-Json
$targets = @(
  @{ Name = "relay"; Pid = [int]$parsed.relayPid },
  @{ Name = "agent"; Pid = [int]$parsed.agentPid }
)

foreach ($target in $targets) {
  if ($target.Pid -le 0) {
    continue
  }
  $proc = Get-Process -Id $target.Pid -ErrorAction SilentlyContinue
  if ($null -eq $proc) {
    Write-Host "$($target.Name) pid=$($target.Pid) already exited"
    continue
  }
  Stop-ProcessSafely -ProcessId $target.Pid -Label $target.Name
}

Stop-WorkerProcesses

if ($KillRelayPort) {
  $relayPids = Get-RelayListenerPids -Port 8787
  foreach ($targetProcessId in $relayPids) {
    Stop-ProcessSafely -ProcessId $targetProcessId -Label "relay listener on 8787"
  }
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "PID file removed."
