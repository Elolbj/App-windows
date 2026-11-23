# Informations systeme complementaires : activation, durees de demarrage,
# points de restauration, fuseau horaire. ASCII uniquement.
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$out = [ordered]@{}

function Section([string]$name, [scriptblock]$block) {
    try { $out[$name] = & $block }
    catch { [void]$errors.Add("${name}: $($_.Exception.Message)"); $out[$name] = $null }
}

# Licence Windows (ApplicationID = Windows)
Section 'activation' {
    @(Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f' AND PartialProductKey IS NOT NULL" | ForEach-Object {
        [pscustomobject]@{ name = $_.Name; status = [int]$_.LicenseStatus; channel = [string]$_.ProductKeyChannel }
    })
}

# Duree des demarrages (evenement 100, souvent reserve aux administrateurs)
Section 'boot' {
    try {
        $evs = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Diagnostics-Performance/Operational'; Id = 100 } -MaxEvents 30)
    }
    catch {
        if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { $evs = @() } else { throw }
    }
    @($evs | ForEach-Object {
        $xml = [xml]$_.ToXml()
        $d = @{}
        foreach ($n in $xml.Event.EventData.Data) { $d[[string]$n.Name] = [string]$n.'#text' }
        [pscustomobject]@{
            time       = $_.TimeCreated.ToString('s')
            bootMs     = [int64]$d['BootTime']
            mainPathMs = [int64]$d['MainPathBootTime']
            postBootMs = [int64]$d['BootPostBootTime']
        }
    })
}

Section 'restorePoints' {
    @(Get-ComputerRestorePoint | ForEach-Object {
        [pscustomobject]@{
            description = $_.Description
            time        = ([Management.ManagementDateTimeConverter]::ToDateTime($_.CreationTime)).ToString('s')
        }
    })
}

Section 'timezone' { (Get-TimeZone).DisplayName }

$out['errors'] = @($errors)
$json = $out | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
