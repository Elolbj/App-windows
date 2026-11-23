# Pilotes installes (hors pilotes fournis par Microsoft). Requete lente (5-15 s).
# ASCII uniquement.
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$drivers = New-Object System.Collections.ArrayList
$total = 0

function DateStr($d) { if ($d) { try { return ([datetime]$d).ToString('s') } catch { return $null } } return $null }

try {
    $all = @(Get-CimInstance Win32_PnPSignedDriver)
    $total = $all.Count
    foreach ($d in $all) {
        if (-not $d.DeviceName -or -not $d.DriverProviderName) { continue }
        if ($d.DriverProviderName -eq 'Microsoft') { continue }
        [void]$drivers.Add([pscustomobject]@{
            device   = $d.DeviceName
            class    = $d.DeviceClass
            provider = $d.DriverProviderName
            version  = $d.DriverVersion
            date     = (DateStr $d.DriverDate)
            signed   = [bool]$d.IsSigned
            signer   = $d.Signer
            inf      = $d.InfName
        })
    }
}
catch { [void]$errors.Add("drivers: $($_.Exception.Message)") }

$out = [ordered]@{ total = $total; drivers = @($drivers); errors = @($errors) }
$json = $out | ConvertTo-Json -Depth 4 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
