# Recherche des mises a jour disponibles (peut prendre plusieurs minutes,
# interroge les serveurs Windows Update). ASCII uniquement.
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$pending = New-Object System.Collections.ArrayList

try {
    $session = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    $result = $searcher.Search('IsInstalled=0 and IsHidden=0')
    foreach ($u in $result.Updates) {
        $cats = @($u.Categories | ForEach-Object { [string]$_.Name })
        $kbs = @($u.KBArticleIDs | ForEach-Object { 'KB' + [string]$_ })
        [void]$pending.Add([pscustomobject]@{
            title      = [string]$u.Title
            kb         = ($kbs -join ', ')
            severity   = [string]$u.MsrcSeverity
            size       = [uint64]$u.MaxDownloadSize
            downloaded = [bool]$u.IsDownloaded
            mandatory  = [bool]$u.IsMandatory
            categories = $cats
        })
    }
}
catch { [void]$errors.Add("search: $($_.Exception.Message)") }

$out = [ordered]@{ updates = @($pending); errors = @($errors) }
$json = $out | ConvertTo-Json -Depth 4 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
