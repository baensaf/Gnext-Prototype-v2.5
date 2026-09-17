<#
.SYNOPSIS
  Installs the Gnext branch agent as a Windows service and enrols it (protocol §3.1).

.EXAMPLE
  # From an elevated PowerShell, in the folder holding gnext-agent.exe:
  .\install.ps1 -Server https://app.example.ir -Code K7QM-4XPD
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Code,
  [string]$Exe = (Join-Path $PSScriptRoot 'gnext-agent.exe')
)
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from an elevated (Administrator) PowerShell.'
}
if (-not (Test-Path $Exe)) { throw "gnext-agent.exe not found at $Exe" }

$serviceName = 'GnextAgent'
$installDir = Join-Path $env:ProgramFiles 'Gnext\Agent'
$dataDir = Join-Path $env:ProgramData 'Gnext\Agent'
$target = Join-Path $installDir 'gnext-agent.exe'

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -ne 'Stopped') {
  Stop-Service -Name $serviceName -Force
  $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -Force $Exe $target

# Only SYSTEM and Administrators may read the data folder: identity.json holds the device key.
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
& icacls $dataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null

if (-not $existing) {
  & sc.exe create $serviceName binPath= "`"$target`"" start= auto DisplayName= 'Gnext Branch Agent' | Out-Null
  & sc.exe description $serviceName 'Connects this branch''s printers and card terminals to Gnext.' | Out-Null
}
# Restart on every failure after 10 s, including a non-zero exit (the update restart, §9.2).
& sc.exe failure $serviceName reset= 86400 actions= restart/10000/restart/10000/restart/10000 | Out-Null
& sc.exe failureflag $serviceName 1 | Out-Null

& $target enrol --server $Server --code $Code
if ($LASTEXITCODE -ne 0) { throw 'Enrolment failed; the service was installed but not started.' }

Start-Service -Name $serviceName
Write-Host "Gnext agent installed and running. Logs: $dataDir\logs\agent.log"
