param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

function Get-NullableString($value) {
  if ($null -eq $value) { return $null }
  $text = [string]$value
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  return $text.Trim()
}

function Get-BooleanValue($value) {
  if ($null -eq $value) { return $false }
  try { return [Convert]::ToInt32($value) -ne 0 } catch { return $false }
}

$records = New-Object System.Collections.Generic.List[object]
$uninstallPath = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
$locations = @(
  @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Registry64; Scope = 'machine'; Label = '64' },
  @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Registry32; Scope = 'machine'; Label = '32' },
  @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Registry64; Scope = 'user'; Label = '64' },
  @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Registry32; Scope = 'user'; Label = '32' }
)

foreach ($location in $locations) {
  $base = $null
  $uninstall = $null
  try {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($location.Hive, $location.View)
    $uninstall = $base.OpenSubKey($uninstallPath, $false)
    if ($null -eq $uninstall) { continue }
    foreach ($subKeyName in $uninstall.GetSubKeyNames()) {
      $entry = $null
      try {
        $entry = $uninstall.OpenSubKey($subKeyName, $false)
        if ($null -eq $entry) { continue }
        $displayName = Get-NullableString $entry.GetValue('DisplayName', $null, 'DoNotExpandEnvironmentNames')
        if ($null -eq $displayName) { continue }
        $windowsInstaller = Get-BooleanValue $entry.GetValue('WindowsInstaller')
        $productCode = $null
        if ($windowsInstaller -and $subKeyName -match '^\{[0-9A-Fa-f-]{36}\}$') { $productCode = $subKeyName }
        $estimatedSize = $entry.GetValue('EstimatedSize')
        if ($null -ne $estimatedSize) { try { $estimatedSize = [double]$estimatedSize } catch { $estimatedSize = $null } }
        $records.Add([pscustomobject]@{
          source = 'registry'
          scope = $location.Scope
          registryView = $location.Label
          registryKey = $subKeyName
          displayName = $displayName
          publisher = Get-NullableString $entry.GetValue('Publisher', $null, 'DoNotExpandEnvironmentNames')
          displayVersion = Get-NullableString $entry.GetValue('DisplayVersion', $null, 'DoNotExpandEnvironmentNames')
          installLocation = Get-NullableString $entry.GetValue('InstallLocation', $null, 'DoNotExpandEnvironmentNames')
          estimatedSizeKb = $estimatedSize
          uninstallString = Get-NullableString $entry.GetValue('UninstallString', $null, 'DoNotExpandEnvironmentNames')
          quietUninstallString = Get-NullableString $entry.GetValue('QuietUninstallString', $null, 'DoNotExpandEnvironmentNames')
          windowsInstaller = $windowsInstaller
          systemComponent = Get-BooleanValue $entry.GetValue('SystemComponent')
          productCode = $productCode
          packageFullName = $null
          installDate = Get-NullableString $entry.GetValue('InstallDate', $null, 'DoNotExpandEnvironmentNames')
        })
      } catch {
        continue
      } finally {
        if ($null -ne $entry) { $entry.Dispose() }
      }
    }
  } catch {
    continue
  } finally {
    if ($null -ne $uninstall) { $uninstall.Dispose() }
    if ($null -ne $base) { $base.Dispose() }
  }
}

try {
  foreach ($package in @(Get-AppxPackage -PackageTypeFilter Main, Bundle -ErrorAction Stop)) {
    if ($package.IsFramework -or $package.IsResourcePackage) { continue }
    $records.Add([pscustomobject]@{
      source = 'appx'
      scope = 'user'
      registryView = $null
      registryKey = $null
      displayName = [string]$package.Name
      publisher = Get-NullableString $package.Publisher
      displayVersion = [string]$package.Version
      installLocation = Get-NullableString $package.InstallLocation
      estimatedSizeKb = $null
      uninstallString = $null
      quietUninstallString = $null
      windowsInstaller = $false
      systemComponent = $false
      productCode = $null
      packageFullName = [string]$package.PackageFullName
      installDate = $null
    })
  }
} catch {
  # Registry inventory remains useful when the Appx provider is unavailable.
}

$array = $records.ToArray()
ConvertTo-Json -InputObject $array -Depth 4 -Compress
