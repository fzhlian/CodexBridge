param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [ValidateSet("relay", "agent")]
  [string]$Role,
  [switch]$ForceMemoryStore
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

Import-EnvFileAsFallback -Path ".env.test"

if ($ForceMemoryStore) {
  [Environment]::SetEnvironmentVariable("STORE_MODE", "memory", "Process")
  [Environment]::SetEnvironmentVariable("AUDIT_INDEX_MODE", "memory", "Process")
}

if ($Role -eq "relay") {
  pnpm --filter @codexbridge/relay-server run dev
  exit $LASTEXITCODE
}

pnpm --filter ./packages/vscode-agent run dev:node
exit $LASTEXITCODE
