param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [ValidateSet("relay", "agent")]
  [string]$Role,
  [switch]$ForceMemoryStore
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $RepoPath

Get-Content ".env.test" | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $pair = $line -split "=", 2
  if ($pair.Count -eq 2) {
    [Environment]::SetEnvironmentVariable($pair[0], $pair[1], "Process")
  }
}

if ($ForceMemoryStore) {
  [Environment]::SetEnvironmentVariable("STORE_MODE", "memory", "Process")
  [Environment]::SetEnvironmentVariable("AUDIT_INDEX_MODE", "memory", "Process")
}

if ($Role -eq "relay") {
  pnpm --filter @codexbridge/relay-server run dev
  exit $LASTEXITCODE
}

pnpm --filter @codexbridge/vscode-agent run dev:node
exit $LASTEXITCODE
