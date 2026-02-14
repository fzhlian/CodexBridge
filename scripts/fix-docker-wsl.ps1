param(
  [switch]$SkipReboot
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this script in an elevated PowerShell (Run as Administrator)."
  }
}

function Enable-FeatureIfNeeded {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FeatureName
  )

  $state = (Get-WindowsOptionalFeature -Online -FeatureName $FeatureName).State
  if ($state -eq "Enabled") {
    Write-Host "$FeatureName already enabled."
    return
  }

  Write-Host "Enabling $FeatureName ..."
  dism /online /enable-feature /featurename:$FeatureName /all /norestart | Out-Null
}

Assert-Admin

Enable-FeatureIfNeeded -FeatureName "VirtualMachinePlatform"
Enable-FeatureIfNeeded -FeatureName "Microsoft-Windows-Subsystem-Linux"
Enable-FeatureIfNeeded -FeatureName "HypervisorPlatform"

Write-Host "Setting hypervisorlaunchtype=auto ..."
bcdedit /set hypervisorlaunchtype auto | Out-Null

Write-Host "Installing/updating WSL components ..."
wsl --install --no-distribution
wsl --update
wsl --set-default-version 2

if (-not $SkipReboot) {
  Write-Host "System reboot is required. Rebooting in 10 seconds..."
  shutdown /r /t 10
} else {
  Write-Host "Reboot required. Please reboot manually before starting Docker Desktop."
}
