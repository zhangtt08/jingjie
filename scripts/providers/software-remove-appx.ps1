param(
    [Parameter(Mandatory = $true)]
    [string]$Payload
)

$ErrorActionPreference = 'Stop'

function Result([int]$ExitCode, [string]$StandardOutput, [string]$StandardError) {
    ConvertTo-Json -InputObject ([ordered]@{
        exitCode = $ExitCode
        stdout = $StandardOutput
        stderr = $StandardError
        timedOut = $false
    }) -Depth 3 -Compress
}

try {
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
    $request = ConvertFrom-Json -InputObject $json
    $packageFullName = [string]$request.packageFullName
    if ([string]::IsNullOrWhiteSpace($packageFullName) -or $packageFullName -notmatch '^[A-Za-z0-9._-]+$') {
        Result 40 '' 'invalid-package-identity'
        exit 0
    }

    # SECURITY-REVIEW S-08 (defence in depth): the caller is expected to have applied the
    # protection policy already, but this script is the last thing standing between a request
    # and Remove-AppxPackage. Packages that make the shell, the Store runtime or Windows Update
    # work are refused here as well, so a bad caller -- or a bad future policy table -- cannot
    # take the desktop down through this entry point.
    $criticalPattern = '(Microsoft\.Windows\.(ShellExperience|StartMenu)|Microsoft\.Windows\.Client\.(ContentDelivery|Provisioning)|Microsoft\.Windows\.StorageService|Microsoft\.\.NET|Microsoft\.UI\.Xaml|Microsoft\.VCLibs|Microsoft\.NET\.Native|Microsoft\.WindowsAppRuntime|Microsoft\.DesignKey|Microsoft\.Audioserver|InputApp|Microsoft\.Windows\.CurrentBrowser|Microsoft\.Getstarted)'
    if ($packageFullName -match $criticalPattern) {
        Result 41 '' 'protected-package-refused'
        exit 0
    }

    $package = Get-AppxPackage -PackageTypeFilter Main | Where-Object {
        $_.PackageFullName -ceq $packageFullName
    } | Select-Object -First 1
    if ($null -eq $package) {
        Result 0 'already-absent' ''
        exit 0
    }

    Remove-AppxPackage -Package $package.PackageFullName -Confirm:$false -ErrorAction Stop
    Result 0 'removed' ''
} catch {
    Result 1 '' $_.Exception.GetType().Name
}
