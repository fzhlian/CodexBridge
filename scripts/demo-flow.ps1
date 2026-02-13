param(
  [string]$RelayBase = "http://127.0.0.1:8787",
  [string]$UserId = "u1",
  [string]$MachineId = "dev-machine-1",
  [string]$Prompt = "fix bug in src/main.ts"
)

$ErrorActionPreference = "Stop"

Write-Host "1) Send patch command..."
$body = @{
  msgId = "demo-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  userId = $UserId
  machineId = $MachineId
  text = "@dev patch $Prompt"
} | ConvertTo-Json -Compress

$patchResp = Invoke-RestMethod -Uri "$RelayBase/wecom/callback" -Method Post -ContentType "application/json" -Body $body
$patchResp | ConvertTo-Json -Depth 5

if (-not $patchResp.commandId) {
  Write-Warning "Patch command not dispatched."
  exit 0
}

$patchCommandId = $patchResp.commandId
Write-Host "patch command id: $patchCommandId"

Write-Host "2) Query command state..."
Start-Sleep -Seconds 2
try {
  $cmd = Invoke-RestMethod -Uri "$RelayBase/commands/$patchCommandId" -Method Get
  $cmd | ConvertTo-Json -Depth 7
} catch {
  Write-Warning "Unable to query command state yet."
}

Write-Host "3) Send apply command referencing patch command id..."
$applyBody = @{
  msgId = "demo-apply-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  userId = $UserId
  machineId = $MachineId
  text = "@dev apply $patchCommandId"
} | ConvertTo-Json -Compress

$applyResp = Invoke-RestMethod -Uri "$RelayBase/wecom/callback" -Method Post -ContentType "application/json" -Body $applyBody
$applyResp | ConvertTo-Json -Depth 5

Write-Host "Done. Check relay logs and /audit/recent for lifecycle details."

