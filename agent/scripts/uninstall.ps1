<#
.SYNOPSIS
  Removes the Gnext branch agent service and program files. The data folder
  (%ProgramData%\Gnext\Agent: identity, journal, logs) is kept unless -RemoveData is given.
#>
param([switch]$RemoveData)
$ErrorActionPreference = 'Stop'

$serviceName = 'GnextAgent'
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc) {
  if ($svc.Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -Force
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  }
  & sc.exe delete $serviceName | Out-Null
}
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $env:ProgramFiles 'Gnext\Agent')
if ($RemoveData) {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $env:ProgramData 'Gnext\Agent')
}
Write-Host 'Gnext agent removed.'
