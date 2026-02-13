param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $RepoPath

if (-not (Test-Path ".env.test")) {
  throw ".env.test not found. Run scripts/bootstrap-test-env.ps1 first."
}

Get-Content ".env.test" | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $pair = $line -split "=", 2
  if ($pair.Count -ne 2) { return }
  [Environment]::SetEnvironmentVariable($pair[0], $pair[1], "Process")
}

Write-Host "Starting relay and agent terminals..."

$relayCmd = "Set-Location -LiteralPath '$RepoPath'; " +
  "Get-Content '.env.test' | ForEach-Object { " +
  '$line = $_.Trim(); if (-not $line -or $line.StartsWith("#")) { return }; ' +
  '$pair = $line -split "=",2; if ($pair.Count -eq 2) { [Environment]::SetEnvironmentVariable($pair[0],$pair[1],"Process") } }; ' +
  "pnpm --filter @codexbridge/relay-server run dev"

$agentCmd = "Set-Location -LiteralPath '$RepoPath'; " +
  "Get-Content '.env.test' | ForEach-Object { " +
  '$line = $_.Trim(); if (-not $line -or $line.StartsWith("#")) { return }; ' +
  '$pair = $line -split "=",2; if ($pair.Count -eq 2) { [Environment]::SetEnvironmentVariable($pair[0],$pair[1],"Process") } }; ' +
  "pnpm --filter @codexbridge/vscode-agent run dev:node"

Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $relayCmd
Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $agentCmd

Write-Host "Relay and agent started in separate windows."
Write-Host "Use scripts/demo-flow.ps1 to test command flow."

