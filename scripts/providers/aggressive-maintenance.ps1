param(
    [Parameter(Mandatory = $true)]
    [string]$Payload
)

$ErrorActionPreference = 'Stop'

function MaintenanceCandidate(
    [string]$ActionId,
    [string]$Label,
    [bool]$Supported,
    [string]$Impact,
    [string]$Preservation,
    [string]$UnavailableReason
) {
    [ordered]@{
        actionId = $ActionId
        label = $Label
        supported = $Supported
        sizeBytes = 0
        sizeIsEstimate = $true
        impact = $Impact
        preservationSummary = $Preservation
        unavailableReason = $UnavailableReason
    }
}

try {
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
    $request = ConvertFrom-Json -InputObject $json
    if ([string]$request.operation -ne 'probe') { throw 'invalid-maintenance-request' }
    $trustedDeliveryModule = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\DeliveryOptimization\DeliveryOptimization.psd1'
    $delivery = Test-Path -LiteralPath $trustedDeliveryModule -PathType Leaf
    $dism = Join-Path $env:SystemRoot 'System32\Dism.exe'
    $result = @(
        (MaintenanceCandidate 'delivery-optimization' 'Delivery Optimization cache' $delivery 'Redownload update cache' 'Keep update and recovery data' $(if ($delivery) { $null } else { 'delivery-optimization-unsupported' })),
        (MaintenanceCandidate 'component-cleanup' 'Windows component cleanup' (Test-Path -LiteralPath $dism -PathType Leaf) 'Remove superseded components' 'Keep update uninstall and recovery data' $(if (Test-Path -LiteralPath $dism -PathType Leaf) { $null } else { 'dism-not-found' }))
    )
    ConvertTo-Json -InputObject $result -Compress -Depth 5
} catch {
    Write-Error ([string]$_.Exception.Message)
    exit 1
}
