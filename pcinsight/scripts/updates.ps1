# Historique Windows Update (API COM de l'agent Windows Update) + correctifs installes.
# ASCII uniquement.
param(
    [Parameter(Mandatory = $true)][string]$OutFile,
    [int]$Max = 400
)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$history = New-Object System.Collections.ArrayList
$total = 0

try {
    $session = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    $total = [int]$searcher.GetTotalHistoryCount()
    if ($total -gt 0) {
        $items = $searcher.QueryHistory(0, [Math]::Min($total, $Max))
        foreach ($h in $items) {
            if (-not $h.Title) { continue }
            $kb = $null
            if ($h.Title -match 'KB(\d{6,8})') { $kb = 'KB' + $Matches[1] }
            [void]$history.Add([pscustomobject]@{
                title     = [string]$h.Title
                date      = $h.Date.ToString('s')
                result    = [int]$h.ResultCode
                operation = [int]$h.Operation
                hresult   = [int64]$h.HResult
                kb        = $kb
            })
        }
    }
}
catch { [void]$errors.Add("history: $($_.Exception.Message)") }

$hotfixes = New-Object System.Collections.ArrayList
try {
    foreach ($hf in @(Get-HotFix)) {
        $d = $null
        try { if ($hf.InstalledOn) { $d = ([datetime]$hf.InstalledOn).ToString('s') } } catch {}
        [void]$hotfixes.Add([pscustomobject]@{ id = $hf.HotFixID; description = $hf.Description; installedOn = $d })
    }
}
catch { [void]$errors.Add("hotfix: $($_.Exception.Message)") }

$out = [ordered]@{
    total    = $total
    history  = @($history)
    hotfixes = @($hotfixes)
    errors   = @($errors)
}
$json = $out | ConvertTo-Json -Depth 4 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
