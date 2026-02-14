param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [switch]$StopStack
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $RepoPath

if ($StopStack) {
  & powershell -ExecutionPolicy Bypass -File ".\scripts\stop-test-stack.ps1" -RepoPath $RepoPath | Out-Null
}

$paths = @(
  "tmp\dev-up-report.json",
  "tmp\logs\relay-dev.out.log",
  "tmp\logs\relay-dev.err.log",
  "tmp\logs\agent-dev.out.log",
  "tmp\logs\agent-dev.err.log",
  "tmp\logs\stack-pids.json"
)

foreach ($relative in $paths) {
  $full = Join-Path $RepoPath $relative
  if (Test-Path $full) {
    Remove-Item $full -Force -ErrorAction SilentlyContinue
    Write-Host "Removed $full"
  }
}

Write-Host "Dev state cleaned."
