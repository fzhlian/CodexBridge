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
  $agentCmds = @(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like "*pnpm run build && node dist/src/index.js*" })

  foreach ($cmd in $agentCmds) {
    $childNodes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ParentProcessId -eq $cmd.ProcessId })
    foreach ($node in $childNodes) {
      Stop-ProcessSafely -ProcessId ([int]$node.ProcessId) -Label "orphan agent node"
    }
    Stop-ProcessSafely -ProcessId ([int]$cmd.ProcessId) -Label "orphan agent cmd"
  }

  $connectedNodePids = @()
  try {
    $connections = @(Get-NetTCPConnection -RemoteAddress "127.0.0.1" -RemotePort 8787 -State Established -ErrorAction SilentlyContinue)
    $connectedNodePids = @($connections | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
  } catch {
    $connectedNodePids = @()
  }

  foreach ($targetPid in $connectedNodePids) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$targetPid" -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
      continue
    }
    if ($proc.Name -ne "node.exe") {
      continue
    }
    if ($proc.CommandLine -notlike "*node*dist/src/index.js*") {
      continue
    }
    Stop-ProcessSafely -ProcessId $targetPid -Label "orphan relay-client node"
  }
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
