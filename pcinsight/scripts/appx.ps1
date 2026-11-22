# Applications du Microsoft Store installees pour l'utilisateur courant. ASCII uniquement.
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$apps = New-Object System.Collections.ArrayList

try {
    foreach ($p in @(Get-AppxPackage)) {
        if ($p.IsFramework -or $p.IsResourcePackage) { continue }
        [void]$apps.Add([pscustomobject]@{
            name        = $p.Name
            version     = [string]$p.Version
            publisher   = [string]$p.Publisher
            signature   = [string]$p.SignatureKind
            nonRemovable = [bool]$p.NonRemovable
        })
    }
}
catch { [void]$errors.Add("appx: $($_.Exception.Message)") }

$out = [ordered]@{ apps = @($apps); errors = @($errors) }
$json = $out | ConvertTo-Json -Depth 4 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
