param(
    [Parameter(Mandatory = $true)]
    [string]$Payload
)

$ErrorActionPreference = 'Stop'

function Result([bool]$Ok, [string]$Reason) {
    ConvertTo-Json -InputObject ([ordered]@{ ok = $Ok; reason = $Reason }) -Compress
}

function RegistryContext([object]$Request, [bool]$Writable) {
    if ($Request.hive -notin @('HKCU', 'HKLM') -or $Request.view -notin @('32', '64')) { throw 'invalid-registry-location' }
    $allowedKeys = @(
        'Software\Microsoft\Windows\CurrentVersion\Run',
        'Software\Microsoft\Windows\CurrentVersion\RunOnce'
    )
    if ($Request.key -notin $allowedKeys -or [string]::IsNullOrWhiteSpace([string]$Request.valueName)) { throw 'invalid-registry-location' }
    if ($Request.valueKind -notin @('String', 'ExpandString')) { throw 'invalid-registry-kind' }
    $hive = if ($Request.hive -eq 'HKCU') { [Microsoft.Win32.RegistryHive]::CurrentUser } else { [Microsoft.Win32.RegistryHive]::LocalMachine }
    $view = if ($Request.view -eq '64') { [Microsoft.Win32.RegistryView]::Registry64 } else { [Microsoft.Win32.RegistryView]::Registry32 }
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    $key = $base.OpenSubKey([string]$Request.key, $Writable)
    if ($null -eq $key) { $base.Dispose(); throw 'registry-key-missing' }
    return [ordered]@{ Base = $base; Key = $key }
}

function With-RegistryContext([object]$Request, [scriptblock]$Action) {
    $context = RegistryContext $Request $true
    try { & $Action $context.Key }
    finally { $context.Key.Dispose(); $context.Base.Dispose() }
}

function TaskParts([string]$FullPath) {
    if ([string]::IsNullOrWhiteSpace($FullPath) -or $FullPath -notmatch '^\\' -or $FullPath -like '\Microsoft\*') { throw 'invalid-task-path' }
    $lastSlash = $FullPath.LastIndexOf('\')
    if ($lastSlash -lt 0 -or $lastSlash -eq $FullPath.Length - 1) { throw 'invalid-task-path' }
    $taskPath = $FullPath.Substring(0, $lastSlash + 1)
    $taskName = $FullPath.Substring($lastSlash + 1)
    return [ordered]@{ Path = $taskPath; Name = $taskName }
}

try {
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
    $request = ConvertFrom-Json -InputObject $json
    switch ([string]$request.operation) {
        'disable-registry' {
            With-RegistryContext $request {
                param($key)
                $current = [string]$key.GetValue([string]$request.valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                if ($null -eq $current) { throw 'registry-value-missing' }
                if (-not [string]::Equals($current, [string]$request.expectedValue, [StringComparison]::Ordinal)) { throw 'changed-since-inventory' }
                $expectedKind = if ($request.valueKind -eq 'ExpandString') { [Microsoft.Win32.RegistryValueKind]::ExpandString } else { [Microsoft.Win32.RegistryValueKind]::String }
                if ($key.GetValueKind([string]$request.valueName) -ne $expectedKind) { throw 'changed-since-inventory' }
                $key.DeleteValue([string]$request.valueName, $true)
            }
        }
        'restore-registry' {
            With-RegistryContext $request {
                param($key)
                if ($key.GetValueNames() -contains [string]$request.valueName) { throw 'restore-conflict' }
                $kind = if ($request.valueKind -eq 'ExpandString') { [Microsoft.Win32.RegistryValueKind]::ExpandString } else { [Microsoft.Win32.RegistryValueKind]::String }
                $key.SetValue([string]$request.valueName, [string]$request.value, $kind)
            }
        }
        'disable-task' {
            $parts = TaskParts ([string]$request.taskPath)
            $task = Get-ScheduledTask -TaskPath $parts.Path -TaskName $parts.Name -ErrorAction Stop
            if ([string]$task.State -eq 'Disabled' -or $request.expectedEnabled -ne $true) { throw 'changed-since-inventory' }
            Disable-ScheduledTask -TaskPath $parts.Path -TaskName $parts.Name -ErrorAction Stop | Out-Null
        }
        'restore-task' {
            $parts = TaskParts ([string]$request.taskPath)
            $task = Get-ScheduledTask -TaskPath $parts.Path -TaskName $parts.Name -ErrorAction Stop
            if ([string]$task.State -ne 'Disabled' -or $request.expectedCurrentEnabled -ne $false) { throw 'restore-conflict' }
            Enable-ScheduledTask -TaskPath $parts.Path -TaskName $parts.Name -ErrorAction Stop | Out-Null
        }
        default { throw 'invalid-startup-operation' }
    }
    Result $true $null
} catch {
    Result $false ([string]$_.Exception.Message)
    exit 1
}
