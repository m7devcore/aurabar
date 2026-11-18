param([int]$ElectronPid = 0)

$csPath = Join-Path $PSScriptRoot "Win32Bridge.cs"
$csCode = [System.IO.File]::ReadAllText($csPath, [System.Text.Encoding]::UTF8)
Add-Type -TypeDefinition $csCode -ReferencedAssemblies System.Drawing -ErrorAction Stop
[AuraBarNative.Win32Bridge]::Main(@([string]$ElectronPid))
