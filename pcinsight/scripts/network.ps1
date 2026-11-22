# Configuration reseau : profils (public/prive), DNS, passerelles. ASCII uniquement.
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$out = [ordered]@{}

function Section([string]$name, [scriptblock]$block) {
    try { $out[$name] = & $block }
    catch { [void]$errors.Add("${name}: $($_.Exception.Message)"); $out[$name] = $null }
}

Section 'profiles' {
    @(Get-NetConnectionProfile | ForEach-Object {
        [pscustomobject]@{
            interface    = $_.InterfaceAlias
            network      = $_.Name
            category     = [string]$_.NetworkCategory
            ipv4         = [string]$_.IPv4Connectivity
            ipv6         = [string]$_.IPv6Connectivity
        }
    })
}

Section 'dns' {
    @(Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses.Count -gt 0 } | ForEach-Object {
        [pscustomobject]@{
            interface = $_.InterfaceAlias
            family    = [int]$_.AddressFamily
            servers   = @($_.ServerAddresses)
        }
    })
}

Section 'gateways' {
    @(Get-NetRoute -DestinationPrefix '0.0.0.0/0', '::/0' -ErrorAction SilentlyContinue | ForEach-Object {
        [pscustomobject]@{ interface = $_.InterfaceAlias; nextHop = $_.NextHop; metric = [int]$_.RouteMetric }
    })
}

$out['errors'] = @($errors)
$json = $out | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
