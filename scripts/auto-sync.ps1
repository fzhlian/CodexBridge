param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [string]$Branch = "main",
  [string]$Remote = "origin"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $RepoPath)) {
  throw "Repo path not found: $RepoPath"
}

Set-Location -LiteralPath $RepoPath

if (-not (Test-Path -LiteralPath ".git")) {
  throw "Not a git repository: $RepoPath"
}

git fetch $Remote
git pull --rebase --autostash $Remote $Branch
git push $Remote $Branch

