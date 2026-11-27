param([int]$ElectronPid = 0)

$csPath = Join-Path $PSScriptRoot "Win32Bridge.cs"
$csBytes = [System.IO.File]::ReadAllBytes($csPath)
$sha = [System.Security.Cryptography.SHA256]::Create()
$hash = ([System.BitConverter]::ToString($sha.ComputeHash($csBytes)) -replace '-', '').Substring(0, 12).ToLowerInvariant()
$sha.Dispose()

$loaded = $false
try {
  $cacheDir = Join-Path $env:LOCALAPPDATA "Glassy\native-cache"
  if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
  }
  $dllPath = Join-Path $cacheDir "Win32Bridge-$hash.dll"
  if (-not (Test-Path $dllPath)) {
    $csCode = [System.Text.Encoding]::UTF8.GetString($csBytes)
    $tmpDll = Join-Path $cacheDir "Win32Bridge-$hash-$PID.tmp.dll"
    Add-Type -TypeDefinition $csCode -ReferencedAssemblies System.Drawing,System.Management -OutputAssembly $tmpDll -ErrorAction Stop
    try {
      Move-Item -Path $tmpDll -Destination $dllPath -Force -ErrorAction Stop
    } catch {
      Remove-Item -Path $tmpDll -Force -ErrorAction SilentlyContinue
    }
    # Clean up stale cached assemblies from earlier versions
    Get-ChildItem -Path $cacheDir -Filter "Win32Bridge-*.dll" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -ne $dllPath } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $dllPath) {
    [void][System.Reflection.Assembly]::LoadFrom($dllPath)
    $loaded = $true
  }
} catch {
  $loaded = $false
}

if (-not $loaded) {
  $csCode = [System.Text.Encoding]::UTF8.GetString($csBytes)
  Add-Type -TypeDefinition $csCode -ReferencedAssemblies System.Drawing,System.Management -ErrorAction Stop
}

[GlassyNative.Win32Bridge]::Main(@([string]$ElectronPid))
