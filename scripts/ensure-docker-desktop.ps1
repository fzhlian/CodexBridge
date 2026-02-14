param(
  [int]$TimeoutSec = 90
)

$ErrorActionPreference = "Stop"

function Test-DockerDaemon {
  cmd /c "docker info 1>nul 2>nul"
  return $LASTEXITCODE -eq 0
}

if (Test-DockerDaemon) {
  Write-Host "Docker daemon is already ready."
  exit 0
}

$desktopExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $desktopExe)) {
  throw "Docker Desktop executable not found: $desktopExe"
}

Write-Host "Starting Docker Desktop..."
Start-Process -FilePath $desktopExe | Out-Null

for ($i = 0; $i -lt $TimeoutSec; $i += 3) {
  Start-Sleep -Seconds 3
  if (Test-DockerDaemon) {
    Write-Host "Docker daemon is ready."
    exit 0
  }
}

throw "Docker daemon not ready within $TimeoutSec seconds."
