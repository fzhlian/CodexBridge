param(
  [string]$RepoPath = "D:\fzhlian\Code\CodexBridge",
  [string]$RelayBase = "http://127.0.0.1:8787",
  [string]$CallbackUrl = "",
  [string]$CallbackPath = "/wecom/callback",
  [string]$CloudflaredLogPath = "",
  [int]$TimeoutSec = 10,
  [switch]$SkipPublicCheck,
  [switch]$OutputJson
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
      [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
  }
}

function Normalize-EnvValue {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  $trimmed = $Value.Trim()
  if ($trimmed -eq "__SET_IN_USER_ENV__") { return $null }
  return $trimmed
}

function Normalize-CallbackPath {
  param([string]$PathValue)
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return "/wecom/callback"
  }
  if ($PathValue.StartsWith("/")) {
    return $PathValue
  }
  return "/$PathValue"
}

function Join-CallbackUrl {
  param(
    [string]$BaseUrl,
    [string]$PathValue
  )
  $base = $BaseUrl.TrimEnd("/")
  return "$base$PathValue"
}

function Resolve-LatestQuickTunnelBaseUrl {
  param([string]$LogPath)
  if (-not (Test-Path $LogPath)) {
    return $null
  }
  try {
    $text = Get-Content -Path $LogPath -Raw
  } catch {
    return $null
  }
  $matches = [regex]::Matches(
    $text,
    "https:\/\/([a-z0-9-]+)\.trycloudflare\.com",
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if ($matches.Count -le 0) {
    return $null
  }
  $latestHost = $matches[$matches.Count - 1].Groups[1].Value.ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($latestHost)) {
    return $null
  }
  return "https://$latestHost.trycloudflare.com"
}

function New-ByteArray {
  param([int]$Length)
  return New-Object byte[] $Length
}

function Build-WeComHandshakeQuery {
  param(
    [string]$Token,
    [string]$EncodingAesKey,
    [string]$CorpId
  )

  if ($EncodingAesKey.Length -ne 43) {
    throw "WECOM_ENCODING_AES_KEY must be 43 chars, actual=$($EncodingAesKey.Length)"
  }

  $plain = "cb-ok-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $timestamp = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $nonce = "cb{0:D9}" -f (Get-Random -Minimum 0 -Maximum 1000000000)

  $key = [Convert]::FromBase64String("$EncodingAesKey=")
  if ($key.Length -ne 32) {
    throw "decoded AES key length invalid: $($key.Length)"
  }

  $iv = New-ByteArray -Length 16
  [Array]::Copy($key, 0, $iv, 0, 16)

  $random16 = New-ByteArray -Length 16
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($random16)
  } finally {
    $rng.Dispose()
  }

  $msgBytes = [System.Text.Encoding]::UTF8.GetBytes($plain)
  $msgLenBytes = [System.BitConverter]::GetBytes([System.Net.IPAddress]::HostToNetworkOrder([int]$msgBytes.Length))
  $corpBytes = [System.Text.Encoding]::UTF8.GetBytes($CorpId)

  $raw = New-ByteArray -Length ($random16.Length + $msgLenBytes.Length + $msgBytes.Length + $corpBytes.Length)
  $offset = 0
  [Array]::Copy($random16, 0, $raw, $offset, $random16.Length)
  $offset += $random16.Length
  [Array]::Copy($msgLenBytes, 0, $raw, $offset, $msgLenBytes.Length)
  $offset += $msgLenBytes.Length
  [Array]::Copy($msgBytes, 0, $raw, $offset, $msgBytes.Length)
  $offset += $msgBytes.Length
  [Array]::Copy($corpBytes, 0, $raw, $offset, $corpBytes.Length)

  $blockSize = 32
  $remainder = $raw.Length % $blockSize
  $pad = if ($remainder -eq 0) { $blockSize } else { $blockSize - $remainder }
  $padding = New-ByteArray -Length $pad
  for ($i = 0; $i -lt $pad; $i += 1) {
    $padding[$i] = [byte]$pad
  }

  $padded = New-ByteArray -Length ($raw.Length + $padding.Length)
  [Array]::Copy($raw, 0, $padded, 0, $raw.Length)
  [Array]::Copy($padding, 0, $padded, $raw.Length, $padding.Length)

  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::None
  $aes.KeySize = 256
  $aes.BlockSize = 128
  $aes.Key = $key
  $aes.IV = $iv

  $encryptor = $aes.CreateEncryptor()
  try {
    $cipher = $encryptor.TransformFinalBlock($padded, 0, $padded.Length)
  } finally {
    $encryptor.Dispose()
    $aes.Dispose()
  }
  $echostr = [Convert]::ToBase64String($cipher)

  $parts = @($Token, $timestamp, $nonce, $echostr) | Sort-Object
  $sha1 = [System.Security.Cryptography.SHA1]::Create()
  try {
    $digestBytes = $sha1.ComputeHash([System.Text.Encoding]::UTF8.GetBytes(($parts -join "")))
  } finally {
    $sha1.Dispose()
  }
  $signature = ([BitConverter]::ToString($digestBytes)).Replace("-", "").ToLowerInvariant()

  $query = "msg_signature={0}&timestamp={1}&nonce={2}&echostr={3}" -f `
    [System.Uri]::EscapeDataString($signature), `
    [System.Uri]::EscapeDataString($timestamp), `
    [System.Uri]::EscapeDataString($nonce), `
    [System.Uri]::EscapeDataString($echostr)

  return [pscustomobject]@{
    plain = $plain
    timestamp = $timestamp
    nonce = $nonce
    signature = $signature
    echostr = $echostr
    query = $query
  }
}

function Invoke-CurlGet {
  param(
    [string]$Url,
    [int]$TimeoutSecValue
  )

  $nativePrefVar = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
  $previousNativePref = $null
  if ($nativePrefVar) {
    $previousNativePref = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
  }
  try {
    $rawOutput = & curl.exe -sS --max-time "$TimeoutSecValue" -w "`nHTTPSTATUS:%{http_code}`n" "$Url" 2>&1
  } finally {
    if ($nativePrefVar) {
      $PSNativeCommandUseErrorActionPreference = $previousNativePref
    }
  }
  $exitCode = $LASTEXITCODE
  $merged = ($rawOutput -join "`n")
  $statusMatch = [regex]::Match(
    $merged,
    "HTTPSTATUS:(\d{3})\s*$",
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )

  $statusCode = 0
  $body = $merged
  if ($statusMatch.Success) {
    $statusCode = [int]$statusMatch.Groups[1].Value
    $body = $merged.Substring(0, $statusMatch.Index).TrimEnd("`r", "`n")
  }

  return [pscustomobject]@{
    statusCode = $statusCode
    body = $body
    exitCode = $exitCode
    ok = ($statusCode -eq 200)
  }
}

Import-EnvFileAsFallback -Path ".env.test"

$normalizedCallbackPath = Normalize-CallbackPath -PathValue $CallbackPath
$token = Normalize-EnvValue -Value ([Environment]::GetEnvironmentVariable("WECOM_TOKEN", "Process"))
$aesKey = Normalize-EnvValue -Value ([Environment]::GetEnvironmentVariable("WECOM_ENCODING_AES_KEY", "Process"))
$corpId = Normalize-EnvValue -Value ([Environment]::GetEnvironmentVariable("WECOM_CORP_ID", "Process"))
$explicitCallbackUrl = Normalize-EnvValue -Value $CallbackUrl
$envCallbackUrl = Normalize-EnvValue -Value ([Environment]::GetEnvironmentVariable("WECOM_CALLBACK_URL", "Process"))
$envCallbackBase = Normalize-EnvValue -Value ([Environment]::GetEnvironmentVariable("WECOM_CALLBACK_BASE_URL", "Process"))
$logPath = if (-not [string]::IsNullOrWhiteSpace($CloudflaredLogPath)) {
  $CloudflaredLogPath
} else {
  Join-Path $RepoPath "tmp\cloudflared.log"
}

if (-not $token -or -not $aesKey -or -not $corpId) {
  throw "missing WeCom env. required: WECOM_TOKEN / WECOM_ENCODING_AES_KEY / WECOM_CORP_ID"
}

$baseFromLog = Resolve-LatestQuickTunnelBaseUrl -LogPath $logPath
$resolvedPublicUrl = $null
if ($explicitCallbackUrl) {
  $resolvedPublicUrl = $explicitCallbackUrl
} elseif ($envCallbackUrl) {
  $resolvedPublicUrl = $envCallbackUrl
} elseif ($envCallbackBase) {
  $resolvedPublicUrl = Join-CallbackUrl -BaseUrl $envCallbackBase -PathValue $normalizedCallbackPath
} elseif ($baseFromLog) {
  $resolvedPublicUrl = Join-CallbackUrl -BaseUrl $baseFromLog -PathValue $normalizedCallbackPath
}

$localCallbackUrl = Join-CallbackUrl -BaseUrl $RelayBase -PathValue $normalizedCallbackPath
$handshake = Build-WeComHandshakeQuery -Token $token -EncodingAesKey $aesKey -CorpId $corpId

$localResult = Invoke-CurlGet -Url "${localCallbackUrl}?$($handshake.query)" -TimeoutSecValue $TimeoutSec
$localPass = $localResult.ok -and ($localResult.body -eq $handshake.plain)

$publicResult = $null
$publicPass = $false
if (-not $SkipPublicCheck -and $resolvedPublicUrl) {
  $publicResult = Invoke-CurlGet -Url "${resolvedPublicUrl}?$($handshake.query)" -TimeoutSecValue $TimeoutSec
  $publicPass = $publicResult.ok -and ($publicResult.body -eq $handshake.plain)
}

$report = [pscustomobject]@{
  checkedAt = (Get-Date).ToString("o")
  relayBase = $RelayBase
  callbackPath = $normalizedCallbackPath
  logPath = $logPath
  callbackFromLog = $baseFromLog
  callbackPublic = $resolvedPublicUrl
  callbackLocal = $localCallbackUrl
  expectedEcho = $handshake.plain
  local = [pscustomobject]@{
    pass = $localPass
    statusCode = $localResult.statusCode
    exitCode = $localResult.exitCode
    body = $localResult.body
  }
  public = if ($publicResult) {
    [pscustomobject]@{
      pass = $publicPass
      statusCode = $publicResult.statusCode
      exitCode = $publicResult.exitCode
      body = $publicResult.body
    }
  } else {
    $null
  }
}

if ($OutputJson) {
  $report | ConvertTo-Json -Depth 8
} else {
  Write-Host "WeCom callback verification"
  Write-Host "  local URL  : $localCallbackUrl"
  Write-Host "  public URL : $resolvedPublicUrl"
  Write-Host "  expected   : $($handshake.plain)"
  Write-Host "  local      : pass=$localPass status=$($localResult.statusCode) exit=$($localResult.exitCode)"
  if ($publicResult) {
    Write-Host "  public     : pass=$publicPass status=$($publicResult.statusCode) exit=$($publicResult.exitCode)"
  } elseif ($SkipPublicCheck) {
    Write-Host "  public     : skipped"
  } else {
    Write-Host "  public     : skipped (no callback URL resolved)"
  }
  if ($resolvedPublicUrl) {
    Write-Host "  set in WeCom: $resolvedPublicUrl"
  }
}

if (-not $localPass) {
  exit 2
}
if (-not $SkipPublicCheck -and $resolvedPublicUrl -and -not $publicPass) {
  exit 3
}
exit 0
