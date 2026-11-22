# Inventaire materiel via CIM/WMI. Ecrit un JSON UTF-8 dans $OutFile.
# Fichier volontairement en ASCII : PowerShell 5.1 lit les .ps1 sans BOM en ANSI.
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
$errors = New-Object System.Collections.ArrayList
$out = [ordered]@{}

function DateStr($d) { if ($d) { try { return ([datetime]$d).ToString('s') } catch { return $null } } return $null }
function Dec($arr) {
    if (-not $arr) { return $null }
    return ((@($arr) | Where-Object { $_ -ne 0 } | ForEach-Object { [char][int]$_ }) -join '').Trim()
}
function Section([string]$name, [scriptblock]$block) {
    try { $out[$name] = & $block }
    catch { [void]$errors.Add("${name}: $($_.Exception.Message)"); $out[$name] = $null }
}

Section 'system' {
    $cs = Get-CimInstance Win32_ComputerSystem
    [pscustomobject]@{
        manufacturer  = $cs.Manufacturer
        model         = $cs.Model
        systemType    = $cs.SystemType
        pcSystemType  = [int]$cs.PCSystemType
        totalMemory   = [uint64]$cs.TotalPhysicalMemory
        domain        = $cs.Domain
        partOfDomain  = [bool]$cs.PartOfDomain
    }
}

Section 'os' {
    $os = Get-CimInstance Win32_OperatingSystem
    [pscustomobject]@{
        caption      = $os.Caption
        version      = $os.Version
        build        = $os.BuildNumber
        architecture = $os.OSArchitecture
        installDate  = (DateStr $os.InstallDate)
        lastBoot     = (DateStr $os.LastBootUpTime)
        locale       = $os.Locale
    }
}

Section 'cpu' {
    @(Get-CimInstance Win32_Processor | ForEach-Object {
        [pscustomobject]@{
            name           = ([string]$_.Name).Trim()
            manufacturer   = $_.Manufacturer
            cores          = [int]$_.NumberOfCores
            threads        = [int]$_.NumberOfLogicalProcessors
            maxClockMHz    = [int]$_.MaxClockSpeed
            l2KB           = [int]$_.L2CacheSize
            l3KB           = [int]$_.L3CacheSize
            socket         = $_.SocketDesignation
            virtualization = [bool]$_.VirtualizationFirmwareEnabled
        }
    })
}

Section 'gpu' {
    @(Get-CimInstance Win32_VideoController | ForEach-Object {
        [pscustomobject]@{
            name          = $_.Name
            processor     = $_.VideoProcessor
            driverVersion = $_.DriverVersion
            driverDate    = (DateStr $_.DriverDate)
            adapterRAM    = [uint64]$_.AdapterRAM
            width         = [int]$_.CurrentHorizontalResolution
            height        = [int]$_.CurrentVerticalResolution
            refreshRate   = [int]$_.CurrentRefreshRate
            status        = $_.Status
        }
    })
}

Section 'memoryModules' {
    @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
        [pscustomobject]@{
            capacity        = [uint64]$_.Capacity
            speed           = [int]$_.Speed
            configuredSpeed = [int]$_.ConfiguredClockSpeed
            manufacturer    = ([string]$_.Manufacturer).Trim()
            partNumber      = ([string]$_.PartNumber).Trim()
            slot            = $_.DeviceLocator
            smbiosType      = [int]$_.SMBIOSMemoryType
            formFactor      = [int]$_.FormFactor
        }
    })
}

Section 'memoryArray' {
    $arr = @(Get-CimInstance Win32_PhysicalMemoryArray)
    $slots = 0; $maxKB = 0
    foreach ($a in $arr) {
        $slots += [int]$a.MemoryDevices
        $m = [uint64]$a.MaxCapacityEx
        if ($m -eq 0) { $m = [uint64]$a.MaxCapacity }
        $maxKB += $m
    }
    [pscustomobject]@{ slots = $slots; maxCapacityKB = $maxKB }
}

Section 'board' {
    $b = Get-CimInstance Win32_BaseBoard
    [pscustomobject]@{ manufacturer = $b.Manufacturer; product = $b.Product; version = $b.Version }
}

Section 'bios' {
    $b = Get-CimInstance Win32_BIOS
    [pscustomobject]@{
        manufacturer = $b.Manufacturer
        version      = $b.SMBIOSBIOSVersion
        releaseDate  = (DateStr $b.ReleaseDate)
        smbios       = "$($b.SMBIOSMajorVersion).$($b.SMBIOSMinorVersion)"
    }
}

Section 'physicalDisks' {
    @(Get-CimInstance -Namespace 'root/Microsoft/Windows/Storage' -ClassName MSFT_PhysicalDisk | ForEach-Object {
        [pscustomobject]@{
            deviceId    = [string]$_.DeviceId
            name        = $_.FriendlyName
            mediaType   = [int]$_.MediaType
            busType     = [int]$_.BusType
            health      = [int]$_.HealthStatus
            size        = [uint64]$_.Size
            firmware    = $_.FirmwareVersion
            spindle     = [uint64]$_.SpindleSpeed
        }
    })
}

# Compteurs de fiabilite (temperature, usure) : necessite les droits administrateur
Section 'diskReliability' {
    @(Get-PhysicalDisk | ForEach-Object {
        $pd = $_
        $rc = $pd | Get-StorageReliabilityCounter
        [pscustomobject]@{
            deviceId     = [string]$pd.DeviceId
            temperature  = $rc.Temperature
            temperatureMax = $rc.TemperatureMax
            wear         = $rc.Wear
            powerOnHours = $rc.PowerOnHours
            readErrors   = $rc.ReadErrorsTotal
            writeErrors  = $rc.WriteErrorsTotal
        }
    })
}

Section 'battery' {
    $bats = @(Get-CimInstance Win32_Battery)
    if ($bats.Count -eq 0) { return @() }
    $design = $null; $full = $null; $cycles = $null
    try { $design = (@(Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryStaticData)[0]).DesignedCapacity } catch {}
    try { $full = (@(Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryFullChargedCapacity)[0]).FullChargedCapacity } catch {}
    try { $cycles = (@(Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryCycleCount)[0]).CycleCount } catch {}
    @($bats | ForEach-Object {
        [pscustomobject]@{
            name           = $_.Name
            charge         = [int]$_.EstimatedChargeRemaining
            status         = [int]$_.BatteryStatus
            chemistry      = [int]$_.Chemistry
            designCapacity = $design
            fullCapacity   = $full
            cycleCount     = $cycles
        }
    })
}

Section 'monitors' {
    @(Get-CimInstance -Namespace 'root/wmi' -ClassName WmiMonitorID | ForEach-Object {
        [pscustomobject]@{
            name         = (Dec $_.UserFriendlyName)
            manufacturer = (Dec $_.ManufacturerName)
            year         = [int]$_.YearOfManufacture
        }
    })
}

Section 'networkAdapters' {
    @(Get-CimInstance Win32_NetworkAdapter -Filter 'PhysicalAdapter=True' | ForEach-Object {
        [pscustomobject]@{
            name        = $_.Name
            connection  = $_.NetConnectionID
            mac         = $_.MACAddress
            speed       = [uint64]$_.Speed
            enabled     = [bool]$_.NetEnabled
            manufacturer = $_.Manufacturer
        }
    })
}

Section 'sound' {
    @(Get-CimInstance Win32_SoundDevice | ForEach-Object { [pscustomobject]@{ name = $_.Name; status = $_.Status } })
}

# Peripheriques en erreur (point d'exclamation dans le Gestionnaire de peripheriques)
Section 'problemDevices' {
    @(Get-CimInstance Win32_PnPEntity -Filter 'ConfigManagerErrorCode <> 0' | ForEach-Object {
        [pscustomobject]@{
            name      = $_.Name
            code      = [int]$_.ConfigManagerErrorCode
            class     = $_.PNPClass
            deviceId  = $_.PNPDeviceID
        }
    })
}

$out['errors'] = @($errors)
$json = $out | ConvertTo-Json -Depth 6 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
