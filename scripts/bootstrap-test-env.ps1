param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge"
)

$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $RepoPath

function Assert-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Warning "$name not found in PATH"
    return $false
  }
  return $true
}

Write-Host "[1/5] Checking tools..."
$hasNode = Assert-Command "node"
$hasPnpm = Assert-Command "pnpm"
$hasDocker = Assert-Command "docker"
$hasCodex = Assert-Command "codex"

Write-Host "[2/5] Preparing .env.test..."
if (-not (Test-Path ".env.test")) {
  Copy-Item ".env.test.example" ".env.test"
  Write-Host "Created .env.test from .env.test.example"
} else {
  Write-Host ".env.test already exists (kept as-is)"
}

Write-Host "[3/5] Creating audit directory..."
New-Item -ItemType Directory -Path ".\audit" -Force | Out-Null

Write-Host "[4/5] Starting Redis (docker compose)..."
if ($hasDocker) {
  docker compose -f docker-compose.dev.yml up -d
} else {
  Write-Warning "Docker not available; skip redis startup."
}

Write-Host "[5/5] Installing dependencies..."
if ($hasPnpm) {
  pnpm install
} else {
  Write-Warning "pnpm not available; skip install."
}

Write-Host "`nBootstrap finished."
if (-not ($hasNode -and $hasPnpm -and $hasCodex)) {
  Write-Warning "Missing required tools. Install node/pnpm/codex before full test run."
}

