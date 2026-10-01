$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$records = [System.Collections.Generic.List[object]]::new()

function Text([object]$Value) {
    if ($null -eq $Value) { return $null }
    $normalized = ([string]$Value).Trim()
    if ($normalized.Length -eq 0) { return $null }
    return $normalized
}

function CommandInfo([string]$Command) {
    $expanded = [Environment]::ExpandEnvironmentVariables($Command)
    $executable = $null
    if ($expanded -match '^\s*"([^"]+\.exe)"') {
        $executable = $Matches[1]
    } elseif ($expanded -match '^\s*(.+?\.exe)(?:\s|$)') {
        $executable = $Matches[1].Trim()
    }
    $publisher = $null
    if ($executable -and [IO.Path]::IsPathRooted($executable) -and (Test-Path -LiteralPath $executable -PathType Leaf)) {
        try {
            $item = Get-Item -LiteralPath $executable -ErrorAction Stop
            $executable = $item.FullName
            $publisher = Text $item.VersionInfo.CompanyName
        } catch { }
    }
    return [ordered]@{ executablePath = (Text $executable); publisher = $publisher }
}

function Add-RegistryValues(
    [Microsoft.Win32.RegistryHive]$Hive,
    [string]$HiveName,
    [Microsoft.Win32.RegistryView]$View,
    [string]$ViewName,
    [string]$Scope,
    [string]$KeyPath
) {
    $baseKey = $null
    $key = $null
    try {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
        $key = $baseKey.OpenSubKey($KeyPath, $false)
        if ($null -eq $key) { return }
        foreach ($valueName in $key.GetValueNames()) {
            if ([string]::IsNullOrWhiteSpace($valueName)) { continue }
            $kind = $key.GetValueKind($valueName)
            if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) { continue }
            $command = [string]$key.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            if ([string]::IsNullOrWhiteSpace($command)) { continue }
            $info = CommandInfo $command
            $records.Add([ordered]@{
                source = 'registry'; scope = $Scope; name = $valueName; command = $command
                publisher = $info.publisher; executablePath = $info.executablePath; enabled = $true
                registryHive = $HiveName; registryView = $ViewName; registryKey = $KeyPath
                registryValueName = $valueName; registryValueKind = if ($kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) { 'ExpandString' } else { 'String' }
                filePath = $null; fileSize = $null; fileModifiedAt = $null
                taskPath = $null; taskEnabled = $null; taskActions = @()
            })
        }
    } catch { }
    finally {
        if ($key) { $key.Dispose() }
        if ($baseKey) { $baseKey.Dispose() }
    }
}

$registryLocations = @(
    @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; HiveName = 'HKCU'; Scope = 'user' },
    @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; HiveName = 'HKLM'; Scope = 'machine' }
)
$registryViews = @(
    @{ View = [Microsoft.Win32.RegistryView]::Registry64; Name = '64' },
    @{ View = [Microsoft.Win32.RegistryView]::Registry32; Name = '32' }
)
$runKeys = @(
    'Software\Microsoft\Windows\CurrentVersion\Run',
    'Software\Microsoft\Windows\CurrentVersion\RunOnce'
)
foreach ($location in $registryLocations) {
    foreach ($view in $registryViews) {
        foreach ($runKey in $runKeys) {
            Add-RegistryValues $location.Hive $location.HiveName $view.View $view.Name $location.Scope $runKey
        }
    }
}

$startupFolders = @(
    @{ Path = [Environment]::GetFolderPath('Startup'); Scope = 'user' },
    @{ Path = [Environment]::GetFolderPath('CommonStartup'); Scope = 'machine' }
)
foreach ($folder in $startupFolders) {
    if ([string]::IsNullOrWhiteSpace($folder.Path) -or -not (Test-Path -LiteralPath $folder.Path -PathType Container)) { continue }
    foreach ($file in Get-ChildItem -LiteralPath $folder.Path -File -Force -ErrorAction SilentlyContinue) {
        if ($file.Name -ieq 'desktop.ini') { continue }
        $command = $file.FullName
        $executablePath = $null
        if ($file.Extension -ieq '.lnk') {
            try {
                $shell = New-Object -ComObject WScript.Shell
                $shortcut = $shell.CreateShortcut($file.FullName)
                $executablePath = Text $shortcut.TargetPath
                $command = if ([string]::IsNullOrWhiteSpace($shortcut.Arguments)) { $shortcut.TargetPath } else { '"' + $shortcut.TargetPath + '" ' + $shortcut.Arguments }
            } catch { }
        } elseif ($file.Extension -ieq '.exe') {
            $executablePath = $file.FullName
        }
        $info = CommandInfo $command
        if (-not $executablePath) { $executablePath = $info.executablePath }
        $records.Add([ordered]@{
            source = 'startup-folder'; scope = $folder.Scope; name = $file.BaseName; command = $command
            publisher = $info.publisher; executablePath = $executablePath; enabled = $true
            registryHive = $null; registryView = $null; registryKey = $null; registryValueName = $null; registryValueKind = $null
            filePath = $file.FullName; fileSize = [long]$file.Length; fileModifiedAt = $file.LastWriteTimeUtc.ToString('o')
            taskPath = $null; taskEnabled = $null; taskActions = @()
        })
    }
}

try {
    $tasks = Get-ScheduledTask -ErrorAction Stop | Where-Object {
        $_.TaskPath -notlike '\Microsoft\*' -and
        ($_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'LogonTrigger|AtLogOn' }).Count -gt 0
    }
    foreach ($task in $tasks) {
        $actions = @($task.Actions | ForEach-Object {
            if ([string]::IsNullOrWhiteSpace($_.Arguments)) { [string]$_.Execute } else { '"' + [string]$_.Execute + '" ' + [string]$_.Arguments }
        } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($actions.Count -eq 0) { continue }
        $info = CommandInfo $actions[0]
        $fullTaskPath = $task.TaskPath + $task.TaskName
        $isEnabled = [string]$task.State -ne 'Disabled'
        $records.Add([ordered]@{
            source = 'scheduled-task'; scope = 'machine'; name = $task.TaskName; command = $actions[0]
            publisher = $info.publisher; executablePath = $info.executablePath; enabled = $isEnabled
            registryHive = $null; registryView = $null; registryKey = $null; registryValueName = $null; registryValueKind = $null
            filePath = $null; fileSize = $null; fileModifiedAt = $null
            taskPath = $fullTaskPath; taskEnabled = $isEnabled; taskActions = [string[]]$actions
        })
    }
} catch { }

$array = $records.ToArray()
ConvertTo-Json -InputObject $array -Depth 5 -Compress
