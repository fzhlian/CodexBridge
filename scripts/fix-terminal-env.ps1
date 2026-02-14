$ErrorActionPreference = "Stop"

$requiredPaths = @(
  "C:\Program Files\nodejs",
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\pnpm.pnpm_Microsoft.Winget.Source_8wekyb3d8bbwe",
  "$env:LOCALAPPDATA\Microsoft\WinGet\Links",
  "C:\Program Files\Docker\Docker\resources\bin"
)

function Normalize-PathList {
  param([string[]]$Items)

  $result = New-Object System.Collections.Generic.List[string]
  foreach ($item in $Items) {
    if ([string]::IsNullOrWhiteSpace($item)) {
      continue
    }
    $trimmed = $item.Trim()
    if ($result -notcontains $trimmed) {
      $result.Add($trimmed)
    }
  }
  return $result
}

$sessionParts = @()
if (-not [string]::IsNullOrWhiteSpace($env:Path)) {
  $sessionParts = $env:Path -split ";"
}
$existingRequired = $requiredPaths | Where-Object { Test-Path $_ }
$sessionMerged = Normalize-PathList -Items ($sessionParts + $existingRequired)
$env:Path = ($sessionMerged -join ";")

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$userParts = @()
if (-not [string]::IsNullOrWhiteSpace($userPath)) {
  $userParts = $userPath -split ";"
}
$userMerged = Normalize-PathList -Items ($userParts + $existingRequired)
[Environment]::SetEnvironmentVariable("Path", ($userMerged -join ";"), "User")

Write-Host "Session PATH fixed."
Write-Host "User PATH updated."
Write-Host ""

node -v
pnpm -v
docker --version
