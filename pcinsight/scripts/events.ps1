# Journaux d'evenements Systeme + Application (critiques, erreurs, avertissements)
# et indice de stabilite (Moniteur de fiabilite). ASCII uniquement.
param(
    [Parameter(Mandatory = $true)][string]$OutFile,
    [int]$Days = 30,
    [int]$MaxEvents = 4000,
    [int]$MaxMessages = 400
)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$since = (Get-Date).AddDays(-$Days)

function Clean([string]$text, [int]$max) {
    if (-not $text) { return $null }
    $t = ($text -replace '\s+', ' ').Trim()
    if ($t.Length -gt $max) { $t = $t.Substring(0, $max) + '...' }
    return $t
}

$events = New-Object System.Collections.ArrayList
$truncated = $false
try {
    $filter = @{ LogName = @('System', 'Application'); Level = @(1, 2, 3); StartTime = $since }
    $raw = @(Get-WinEvent -FilterHashtable $filter -MaxEvents $MaxEvents)
    if ($raw.Count -ge $MaxEvents) { $truncated = $true }
    $seen = @{}
    $i = 0
    foreach ($e in $raw) {
        $key = "$($e.ProviderName)|$($e.Id)"
        $msg = $null
        # Le formatage du message est lent : seulement pour les plus recents
        # et pour la premiere occurrence de chaque couple source/ID.
        if ($i -lt $MaxMessages -or -not $seen.ContainsKey($key)) {
            try { $msg = Clean $e.Message 500 } catch { $msg = $null }
            $seen[$key] = $true
        }
        $app = $null
        if (($e.Id -eq 1000 -or $e.Id -eq 1002) -and $e.Properties.Count -gt 0) {
            try { $app = [string]$e.Properties[0].Value } catch {}
        }
        [void]$events.Add([pscustomobject]@{
            time    = $e.TimeCreated.ToString('s')
            log     = $e.LogName
            level   = [int]$e.Level
            id      = [int]$e.Id
            source  = $e.ProviderName
            message = $msg
            app     = $app
        })
        $i++
    }
}
catch {
    if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') {
        [void]$errors.Add("events: $($_.Exception.Message)")
    }
}

# Demarrages / arrets du journal (6005 = demarrage, 6006 = arret propre)
$boots = New-Object System.Collections.ArrayList
try {
    $b = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'EventLog'; Id = @(6005, 6006); StartTime = $since } -MaxEvents 2000)
    foreach ($e in $b) { [void]$boots.Add([pscustomobject]@{ time = $e.TimeCreated.ToString('s'); id = [int]$e.Id }) }
}
catch {
    if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') {
        [void]$errors.Add("boots: $($_.Exception.Message)")
    }
}

# Indice de stabilite (1 a 10), calcule toutes les heures par Windows
$reliability = New-Object System.Collections.ArrayList
try {
    $metrics = Get-CimInstance -ClassName Win32_ReliabilityStabilityMetrics
    foreach ($m in $metrics) {
        if ($m.TimeGenerated -ge $since) {
            [void]$reliability.Add([pscustomobject]@{ time = $m.TimeGenerated.ToString('s'); index = [double]$m.SystemStabilityIndex })
        }
    }
}
catch { [void]$errors.Add("reliability: $($_.Exception.Message)") }

$out = [ordered]@{
    days        = $Days
    since       = $since.ToString('s')
    truncated   = $truncated
    events      = @($events)
    boots       = @($boots)
    reliability = @($reliability)
    errors      = @($errors)
}
$json = $out | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
