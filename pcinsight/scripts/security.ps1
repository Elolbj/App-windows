# Etat de securite : Defender, antivirus tiers, pare-feu, BitLocker, TPM, comptes.
# Certaines sections necessitent les droits administrateur (TPM, BitLocker detaille).
# ASCII uniquement.
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$out = [ordered]@{}

function DateStr($d) { if ($d) { try { return ([datetime]$d).ToString('s') } catch { return $null } } return $null }
function Section([string]$name, [scriptblock]$block) {
    try { $out[$name] = & $block }
    catch { [void]$errors.Add("${name}: $($_.Exception.Message)"); $out[$name] = $null }
}

Section 'defender' {
    $mp = Get-MpComputerStatus
    [pscustomobject]@{
        serviceEnabled   = [bool]$mp.AMServiceEnabled
        antivirusEnabled = [bool]$mp.AntivirusEnabled
        realTime         = [bool]$mp.RealTimeProtectionEnabled
        tamperProtected  = [bool]$mp.IsTamperProtected
        runningMode      = [string]$mp.AMRunningMode
        signatureVersion = [string]$mp.AntivirusSignatureVersion
        signatureUpdated = (DateStr $mp.AntivirusSignatureLastUpdated)
        signatureAge     = [int64]$mp.AntivirusSignatureAge
        quickScanAge     = [int64]$mp.QuickScanAge
        fullScanAge      = [int64]$mp.FullScanAge
        lastQuickScan    = (DateStr $mp.QuickScanEndTime)
    }
}

# Antivirus declares aupres du Centre de securite (postes de travail uniquement)
Section 'antivirus' {
    @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct | ForEach-Object {
        [pscustomobject]@{ name = $_.displayName; state = [int64]$_.productState; path = $_.pathToSignedProductExe }
    })
}

Section 'firewall' {
    @(Get-NetFirewallProfile | ForEach-Object {
        [pscustomobject]@{
            name            = [string]$_.Name
            enabled         = ([string]$_.Enabled -eq 'True')
            inboundDefault  = [string]$_.DefaultInboundAction
            outboundDefault = [string]$_.DefaultOutboundAction
        }
    })
}

# Etat BitLocker lisible sans droits admin via les proprietes du Shell
Section 'bitlocker' {
    $shell = New-Object -ComObject Shell.Application
    @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
        $v = $null
        try { $v = $shell.NameSpace($_.DeviceID + '\').Self.ExtendedProperty('System.Volume.BitLockerProtection') } catch {}
        [pscustomobject]@{ drive = $_.DeviceID; protection = $v }
    })
}

Section 'tpm' {
    $t = Get-Tpm
    [pscustomobject]@{ present = [bool]$t.TpmPresent; ready = [bool]$t.TpmReady; enabled = [bool]$t.TpmEnabled }
}

Section 'users' {
    @(Get-LocalUser | ForEach-Object {
        [pscustomobject]@{
            name             = $_.Name
            enabled          = [bool]$_.Enabled
            lastLogon        = (DateStr $_.LastLogon)
            passwordRequired = [bool]$_.PasswordRequired
            passwordLastSet  = (DateStr $_.PasswordLastSet)
            sid              = [string]$_.SID
        }
    })
}

Section 'admins' {
    @(Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object {
        [pscustomobject]@{ name = [string]$_.Name; type = [string]$_.ObjectClass; source = [string]$_.PrincipalSource }
    })
}

$out['errors'] = @($errors)
$json = $out | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
