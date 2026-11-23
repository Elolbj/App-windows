# Taches planifiees hors dossier \Microsoft\ (mecanisme de persistance frequent).
# ASCII uniquement.
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$tasks = New-Object System.Collections.ArrayList

function DateStr($d) { if ($d) { try { return ([datetime]$d).ToString('s') } catch { return $null } } return $null }

try {
    foreach ($t in @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' })) {
        $info = $null
        try { $info = $t | Get-ScheduledTaskInfo } catch {}
        $actions = @($t.Actions | ForEach-Object {
            if ($_.Execute) { ("$($_.Execute) $($_.Arguments)").Trim() } elseif ($_.ClassId) { "COM $($_.ClassId)" }
        })
        $triggers = @($t.Triggers | ForEach-Object { [string]$_.CimClass.CimClassName })
        [void]$tasks.Add([pscustomobject]@{
            name       = $t.TaskName
            path       = $t.TaskPath
            state      = [string]$t.State
            author     = $t.Author
            actions    = $actions
            triggers   = $triggers
            runAs      = $t.Principal.UserId
            runLevel   = [string]$t.Principal.RunLevel
            lastRun    = (DateStr $info.LastRunTime)
            nextRun    = (DateStr $info.NextRunTime)
            lastResult = $info.LastTaskResult
        })
    }
}
catch { [void]$errors.Add("tasks: $($_.Exception.Message)") }

$out = [ordered]@{ tasks = @($tasks); errors = @($errors) }
$json = $out | ConvertTo-Json -Depth 4 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
