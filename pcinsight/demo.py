"""Données de démonstration réalistes pour les sections propres à Windows.

Utilisées avec l'option --demo, ou automatiquement hors Windows (développement)."""

import datetime as dt
import random

from .collectors import events as ev_mod
from .collectors import software as sw_mod
from .collectors import updates as up_mod
from .collectors.security import decode_av_state

GB = 1024 ** 3
_now = dt.datetime.now


def _iso(d):
    return d.replace(microsecond=0).isoformat()


def hardware():
    return {
        "system": {"manufacturer": "Micro-Star International Co., Ltd.", "model": "MS-7C56",
                   "systemType": "x64-based PC", "pcSystemType": 1, "type_label": "Ordinateur de bureau",
                   "totalMemory": 32 * GB - 300 * 1024 ** 2, "domain": "WORKGROUP", "partOfDomain": False},
        "os": {"caption": "Microsoft Windows 11 Professionnel", "version": "10.0.26200", "build": "26200",
               "architecture": "64 bits", "installDate": _iso(_now() - dt.timedelta(days=410)),
               "lastBoot": _iso(_now() - dt.timedelta(days=3, hours=4))},
        "cpu": [{"name": "AMD Ryzen 5 5600X 6-Core Processor", "manufacturer": "AuthenticAMD", "cores": 6,
                 "threads": 12, "maxClockMHz": 3701, "l2KB": 3072, "l3KB": 32768, "socket": "AM4",
                 "virtualization": True}],
        "gpu": [{"name": "NVIDIA GeForce RTX 3060", "processor": "NVIDIA GeForce RTX 3060",
                 "driverVersion": "32.0.15.8157", "driverDate": "2026-09-18T00:00:00", "adapterRAM": 4293918720,
                 "memory": 12 * GB, "width": 2560, "height": 1440, "refreshRate": 144, "status": "OK"}],
        "memory": {"modules": [
            {"capacity": 16 * GB, "speed": 3200, "configuredSpeed": 3200, "manufacturer": "Kingston",
             "partNumber": "KF3200C16D4/16GX", "slot": "DIMM 0", "smbiosType": 26, "type": "DDR4", "formFactor": 8},
            {"capacity": 16 * GB, "speed": 3200, "configuredSpeed": 3200, "manufacturer": "Kingston",
             "partNumber": "KF3200C16D4/16GX", "slot": "DIMM 1", "smbiosType": 26, "type": "DDR4", "formFactor": 8},
        ], "slots": 4, "max_capacity": 128 * GB, "total": 32 * GB},
        "board": {"manufacturer": "Micro-Star International Co., Ltd.", "product": "B550-A PRO (MS-7C56)",
                  "version": "2.0"},
        "bios": {"manufacturer": "American Megatrends International, LLC.", "version": "A.J0",
                 "releaseDate": "2025-03-12T00:00:00", "smbios": "3.3"},
        "disks": [
            {"deviceId": "0", "name": "Samsung SSD 980 PRO 1TB", "mediaType": 4, "busType": 17, "health": 0,
             "size": 1000204886016, "firmware": "5B2QGXA7", "spindle": 0, "media": "SSD", "bus": "NVMe",
             "health_label": "Bon", "reliability": {"deviceId": "0", "temperature": 41, "temperatureMax": 70,
                                                     "wear": 4, "powerOnHours": 6120, "readErrors": 0,
                                                     "writeErrors": 0}},
            {"deviceId": "1", "name": "ST2000DM008-2FR102", "mediaType": 3, "busType": 11, "health": 0,
             "size": 2000398934016, "firmware": "0001", "spindle": 7200, "media": "HDD", "bus": "SATA",
             "health_label": "Bon", "reliability": None},
        ],
        "battery": [],
        "monitors": [{"name": "LG ULTRAGEAR", "manufacturer": "GSM", "year": 2022}],
        "network_adapters": [
            {"name": "Realtek PCIe 2.5GbE Family Controller", "connection": "Ethernet", "mac": "00:D8:61:AA:BB:CC",
             "speed": 1000000000, "enabled": True, "manufacturer": "Realtek"},
            {"name": "Intel(R) Wi-Fi 6 AX200 160MHz", "connection": "Wi-Fi", "mac": "A4:C3:F0:11:22:33",
             "speed": 0, "enabled": False, "manufacturer": "Intel Corporation"},
        ],
        "sound": [{"name": "Realtek High Definition Audio", "status": "OK"},
                  {"name": "NVIDIA High Definition Audio", "status": "OK"}],
        "problem_devices": [{"name": "Contrôleur de communication simple PCI", "code": 28, "class": None,
                             "deviceId": "PCI\\VEN_8086&DEV_A3BA", "label": "Pilote non installé",
                             "disabled": False}],
        "errors": ["diskReliability: Accès refusé (droits administrateur requis)"],
    }


def software():
    rnd = random.Random(7)
    catalog = [
        ("Google Chrome", "Google LLC", 620), ("Mozilla Firefox (x64 fr)", "Mozilla", 240),
        ("Microsoft Edge", "Microsoft Corporation", 580), ("Microsoft 365 - fr-fr", "Microsoft Corporation", 3900),
        ("Microsoft Visual C++ 2015-2022 Redistributable (x64)", "Microsoft Corporation", 21),
        ("Microsoft Visual C++ 2015-2022 Redistributable (x86)", "Microsoft Corporation", 18),
        ("Python 3.13.1 (64-bit)", "Python Software Foundation", 110), ("Visual Studio Code", "Microsoft Corporation", 380),
        ("Git", "The Git Development Community", 330), ("Node.js", "Node.js Foundation", 95),
        ("Wireshark 4.4.2 x64", "The Wireshark developer community", 230), ("Nmap 7.95", "Nmap Project", 60),
        ("Npcap", "Nmap Project", 3), ("Oracle VirtualBox 7.1.4", "Oracle and/or its affiliates", 560),
        ("Burp Suite Community Edition", "PortSwigger Web Security", 690), ("7-Zip 24.08 (x64)", "Igor Pavlov", 6),
        ("VLC media player", "VideoLAN", 170), ("Steam", "Valve Corporation", 900),
        ("Discord", "Discord Inc.", 310), ("Spotify", "Spotify AB", 420), ("OBS Studio", "OBS Project", 450),
        ("NVIDIA Pilote graphique 581.57", "NVIDIA Corporation", 1200), ("NVIDIA PhysX", "NVIDIA Corporation", 410),
        ("NVIDIA App", "NVIDIA Corporation", 640), ("Realtek High Definition Audio Driver", "Realtek Semiconductor Corp.", 90),
        ("AMD Chipset Software", "Advanced Micro Devices, Inc.", 70), ("MSI Center", "MSI", 520),
        ("Notepad++ (64-bit x64)", "Notepad++ Team", 15), ("Obsidian", "Obsidian", 330),
        ("LibreOffice 24.8", "The Document Foundation", 950), ("GIMP 3.0", "The GIMP Team", 520),
        ("PuTTY release 0.82 (64-bit)", "Simon Tatham", 4), ("WinSCP 6.3.6", "Martin Prikryl", 45),
        ("Docker Desktop", "Docker Inc.", 2100), ("Epic Games Launcher", "Epic Games, Inc.", 210),
        ("Microsoft OneDrive", "Microsoft Corporation", 280), ("Teams Machine-Wide Installer", "Microsoft Corporation", 120),
        ("Java 8 Update 431 (64-bit)", "Oracle Corporation", 130), ("Adobe Acrobat (64-bit)", "Adobe", 1100),
        ("CPUID CPU-Z 2.13", "CPUID, Inc.", 4), ("CrystalDiskInfo 9.5.0", "Crystal Dew World", 12),
        ("HWiNFO64 Version 8.14", "Martin Malík - REALiX", 25), ("Logitech G HUB", "Logitech", 790),
        ("WinRAR 7.01 (64 bits)", "win.rar GmbH", 9), ("Zoom Workplace", "Zoom Communications, Inc.", 270),
        ("Microsoft Update Health Tools", "Microsoft Corporation", 1), ("Outil de résolution", "", None),
    ]
    programs = []
    for name, pub, size in catalog:
        days = rnd.randint(1, 700)
        programs.append({
            "name": name, "version": f"{rnd.randint(1, 30)}.{rnd.randint(0, 9)}.{rnd.randint(0, 999)}",
            "publisher": pub, "install_date": (_now() - dt.timedelta(days=days)).date().isoformat(),
            "size": size * 1024 ** 2 if size else None, "location": "",
            "scope": "Machine" if rnd.random() > 0.15 else "Utilisateur",
            "arch": rnd.choice(["64 bits", "64 bits", "32 bits"]),
        })
    programs.sort(key=lambda p: p["name"].lower())
    startup = [
        {"name": "SecurityHealth", "command": r"%windir%\system32\SecurityHealthSystray.exe", "location": "HKLM\\Run", "enabled": True},
        {"name": "Discord", "command": r"C:\Users\demo\AppData\Local\Discord\Update.exe --processStart Discord.exe", "location": "HKCU\\Run", "enabled": True},
        {"name": "Steam", "command": r'"C:\Program Files (x86)\Steam\steam.exe" -silent', "location": "HKCU\\Run", "enabled": True},
        {"name": "Spotify", "command": r"C:\Users\demo\AppData\Roaming\Spotify\Spotify.exe /minimized", "location": "HKCU\\Run", "enabled": False},
        {"name": "OneDrive", "command": r'"C:\Program Files\Microsoft OneDrive\OneDrive.exe" /background', "location": "HKCU\\Run", "enabled": True},
        {"name": "RtkAudUService", "command": r'"C:\Windows\System32\DriverStore\FileRepository\realtekservice.inf_amd64\RtkAudUService64.exe" -background', "location": "HKLM\\Run", "enabled": True},
        {"name": "MSI Center", "command": r"C:\Program Files (x86)\MSI\One Dragon Center\MSI_Central_Service.exe", "location": "HKLM\\Run (32 bits)", "enabled": True},
        {"name": "Logitech G HUB", "command": r'"C:\Program Files\LGHUB\lghub.exe" --background', "location": "HKLM\\Run", "enabled": True},
        {"name": "EpicGamesLauncher", "command": r'"C:\Program Files (x86)\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe" -silent', "location": "HKCU\\Run", "enabled": False},
        {"name": "Docker Desktop", "command": r"C:\Program Files\Docker\Docker\Docker Desktop.exe -Autostart", "location": "HKCU\\Run", "enabled": True},
    ]
    names = ["AudioSrv", "BFE", "BITS", "CryptSvc", "Dhcp", "Dnscache", "EventLog", "LanmanServer",
             "LanmanWorkstation", "MpsSvc", "Netlogon", "nsi", "Power", "ProfSvc", "RpcSs", "Schedule",
             "SecurityHealthService", "Spooler", "SysMain", "Themes", "W32Time", "WinDefend", "Winmgmt",
             "wuauserv", "WSearch", "TermService", "RemoteRegistry", "Fax", "XblAuthManager", "DiagTrack",
             "edgeupdate", "gupdate", "MSI_Center_Service", "LGHUBUpdaterService", "VBoxSDS", "com.docker.service"]
    services = []
    for n in names:
        start = rnd.choice(["automatic", "automatic", "manual", "manual", "disabled"])
        status = "running" if start == "automatic" and rnd.random() > 0.15 else ("stopped" if start != "manual" or rnd.random() > 0.3 else "running")
        third = n in ("edgeupdate", "gupdate", "MSI_Center_Service", "LGHUBUpdaterService", "VBoxSDS", "com.docker.service")
        binpath = (rf'"C:\Program Files\{n}\{n}.exe"' if third else r"C:\WINDOWS\system32\svchost.exe -k netsvcs")
        services.append({"name": n, "display_name": n, "status": status, "start_type": start, "user": "LocalSystem",
                         "binpath": binpath, "third_party": third and n not in ("edgeupdate",)})
    store = [{"name": n, "version": "1.0.0.0", "publisher": "CN=Microsoft Corporation", "signature": "Store",
              "nonRemovable": False} for n in ("Microsoft.WindowsCalculator", "Microsoft.WindowsTerminal",
                                                "Microsoft.Paint", "Microsoft.ScreenSketch", "Microsoft.WindowsNotepad",
                                                "SpotifyAB.SpotifyMusic", "5319275A.WhatsAppDesktop")]
    return {"programs": programs, "startup": startup, "services": services, "store": store,
            "tasks": scheduled_tasks(), "stats": sw_mod.summarize(programs, startup, services), "errors": []}


def security():
    return {
        "defender": {"serviceEnabled": True, "antivirusEnabled": True, "realTime": True, "tamperProtected": True,
                     "runningMode": "Normal", "signatureVersion": "1.441.392.0",
                     "signatureUpdated": _iso(_now() - dt.timedelta(hours=9)), "signatureAge": 0,
                     "quickScanAge": 1, "fullScanAge": 4294967295,
                     "lastQuickScan": _iso(_now() - dt.timedelta(days=1, hours=2))},
        "antivirus": [{"name": "Windows Defender", **decode_av_state(397568)}],
        "firewall": [{"name": "Domain", "label": "Domaine", "enabled": True, "inboundDefault": "NotConfigured", "outboundDefault": "NotConfigured"},
                     {"name": "Private", "label": "Privé", "enabled": True, "inboundDefault": "NotConfigured", "outboundDefault": "NotConfigured"},
                     {"name": "Public", "label": "Public", "enabled": True, "inboundDefault": "NotConfigured", "outboundDefault": "NotConfigured"}],
        "bitlocker": [{"drive": "C:", "code": 2, "label": "Désactivé", "on": False},
                      {"drive": "D:", "code": 2, "label": "Désactivé", "on": False}],
        "tpm": None,
        "users": [
            {"name": "Administrateur", "enabled": False, "lastLogon": None, "passwordRequired": True, "passwordLastSet": None, "sid": "S-1-5-21-1-500", "builtin_admin": True, "guest": False},
            {"name": "Invité", "enabled": False, "lastLogon": None, "passwordRequired": False, "passwordLastSet": None, "sid": "S-1-5-21-1-501", "builtin_admin": False, "guest": True},
            {"name": "demo", "enabled": True, "lastLogon": _iso(_now() - dt.timedelta(hours=3)), "passwordRequired": True, "passwordLastSet": _iso(_now() - dt.timedelta(days=200)), "sid": "S-1-5-21-1-1001", "builtin_admin": False, "guest": False},
            {"name": "WDAGUtilityAccount", "enabled": False, "lastLogon": None, "passwordRequired": True, "passwordLastSet": None, "sid": "S-1-5-21-1-504", "builtin_admin": False, "guest": False},
        ],
        "admins": [{"name": "PC-DEMO\\Administrateur", "type": "Utilisateur", "source": "Local"},
                   {"name": "PC-DEMO\\demo", "type": "Utilisateur", "source": "Local"}],
        "registry": {"uac_enabled": True, "uac_never_notify": False, "rdp_enabled": False, "rdp_nla": True,
                     "secure_boot": True, "smb1_client": False, "smb1_server": False, "vbs": None,
                     "memory_integrity": True, "lsa_protection": False},
        "exclusions": {"visible": False, "paths": [], "processes": [], "extensions": []},
        "hosts": [{"ip": "127.0.0.1", "names": ["kubernetes.docker.internal"]}],
        "proxy": {"enabled": False, "server": None, "pac": None},
        "errors": ["tpm: Accès refusé (droits administrateur requis)"],
    }


def events(days=30):
    rnd = random.Random(42)
    now = _now()
    templates = [
        # (poids, journal, niveau, id, source, message, app)
        (30, "System", 3, 10016, "Microsoft-Windows-DistributedCOM", "Les paramètres d'autorisation propres à l'application n'accordent pas l'autorisation Activation locale pour l'application serveur COM...", None),
        (12, "System", 2, 7000, "Service Control Manager", "Le service MSI_Center_Service n'a pas pu démarrer en raison de l'erreur : Le service n'a pas répondu assez vite.", None),
        (10, "System", 2, 7031, "Service Control Manager", "Le service LGHUBUpdaterService s'est terminé de manière inattendue.", None),
        (8, "System", 3, 1014, "Microsoft-Windows-DNS-Client", "La résolution du nom telemetry.example.com a expiré après qu'aucun des serveurs DNS configurés n'a répondu.", None),
        (2, "Application", 2, 1000, "Application Error", "Nom de l'application défaillante : Discord.exe, version : 1.0.9170.0, module défaillant : ntdll.dll", "Discord.exe"),
        (1, "Application", 2, 1000, "Application Error", "Nom de l'application défaillante : explorer.exe, version : 10.0.26200.7171, module défaillant : twinui.dll", "explorer.exe"),
        (1, "Application", 2, 1002, "Application Hang", "Le programme chrome.exe version 142.0.7444.60 a cessé d'interagir avec Windows.", "chrome.exe"),
        (7, "Application", 3, 1534, "Microsoft-Windows-User Profiles Service", "Avertissement pendant la notification d'événement de profil...", None),
        (5, "Application", 2, 1, "Microsoft-Windows-Security-SPP", "Échec de la planification du redémarrage du service de protection logicielle.", None),
        (5, "System", 3, 36, "Microsoft-Windows-Time-Service", "Le service de temps n'a pas pu synchroniser l'heure du système pendant 86 400 secondes.", None),
        (3, "System", 2, 10010, "Microsoft-Windows-DistributedCOM", "Le serveur {1B1F472E-3221-4826-97DB-2C2324D389AE} ne s'est pas enregistré auprès de DCOM dans le délai imparti.", None),
        (4, "Application", 2, 0, "VSS", "Erreur du service de cliché instantané des volumes.", None),
        (3, "System", 3, 129, "Microsoft-Windows-Kernel-Boot", "Le chargeur de démarrage n'a pas pu initialiser...", None),
    ]
    weights = [t[0] for t in templates]
    out = []
    for _ in range(620):
        t = rnd.choices(templates, weights)[0]
        when = now - dt.timedelta(seconds=rnd.randint(0, days * 86400))
        out.append({"time": _iso(when), "log": t[1], "level": t[2], "id": t[3], "source": t[4],
                    "message": t[5], "app": t[6]})
    crash = now - dt.timedelta(days=13, hours=5)
    out.append({"time": _iso(crash), "log": "System", "level": 1, "id": 41, "source": "Microsoft-Windows-Kernel-Power",
                "message": "Le système a redémarré sans s'arrêter correctement au préalable.", "app": None})
    out.append({"time": _iso(crash + dt.timedelta(seconds=40)), "log": "System", "level": 2, "id": 6008,
                "source": "EventLog", "message": "L'arrêt système précédent n'était pas prévu.", "app": None})
    out.sort(key=lambda e: e["time"], reverse=True)
    boots = [{"time": _iso(now - dt.timedelta(days=d, hours=rnd.randint(0, 12))), "id": 6005}
             for d in range(0, days, 2)]
    reliability = []
    idx = 9.2
    for h in range(days * 24, 0, -6):
        idx = min(10.0, idx + 0.05)
        if rnd.random() < 0.02:
            idx = max(3.0, idx - rnd.uniform(1, 2.5))
        reliability.append({"time": _iso(now - dt.timedelta(hours=h)), "index": round(idx, 2)})
    return {"events": out, "truncated": False,
            "stats": ev_mod.summarize(out, boots, reliability, days), "errors": []}


def updates():
    rnd = random.Random(3)
    now = _now()
    history = []
    for m in range(14):
        base = (now.replace(day=12) - dt.timedelta(days=30 * m))
        ym = base.strftime("%Y-%m")
        kb = 5070000 - m * 1100
        history.append({"title": f"{ym} Mise à jour cumulative pour Windows 11 Version 25H2 pour les systèmes x64 (KB{kb})",
                        "date": _iso(base + dt.timedelta(days=1)), "result": 4 if m == 2 else 2, "operation": 1,
                        "hresult": -2146498270 if m == 2 else 0, "kb": f"KB{kb}"})
        if m == 2:
            history.append({"title": f"{ym} Mise à jour cumulative pour Windows 11 Version 25H2 pour les systèmes x64 (KB{kb})",
                            "date": _iso(base + dt.timedelta(days=3)), "result": 2, "operation": 1, "hresult": 0, "kb": f"KB{kb}"})
        history.append({"title": f"{ym} Mise à jour cumulative pour .NET Framework 3.5 et 4.8.1 pour Windows 11, version 25H2 (KB{kb + 7})",
                        "date": _iso(base + dt.timedelta(days=1, hours=1)), "result": 2, "operation": 1, "hresult": 0, "kb": f"KB{kb + 7}"})
        history.append({"title": "Outil de suppression de logiciels malveillants Windows x64 - v5.1 (KB890830)",
                        "date": _iso(base + dt.timedelta(days=1, hours=2)), "result": 2, "operation": 1, "hresult": 0, "kb": "KB890830"})
        for d in range(0, 30, 3):
            history.append({"title": f"Mise à jour de la veille de sécurité pour Microsoft Defender Antivirus - KB2267602 (version 1.44{m}.{d}.0)",
                            "date": _iso(base - dt.timedelta(days=d)), "result": 2 if rnd.random() > 0.03 else 4,
                            "operation": 1, "hresult": 0 if rnd.random() > 0.03 else -2145124329, "kb": "KB2267602"})
    history.append({"title": "Intel Corporation - Extension - 10.1.19.2", "date": _iso(now - dt.timedelta(days=95)), "result": 2, "operation": 1, "hresult": 0, "kb": None})
    history.append({"title": "Realtek Semiconductor Corp. - MEDIA - 6.0.9600.1", "date": _iso(now - dt.timedelta(days=180)), "result": 2, "operation": 1, "hresult": 0, "kb": None})
    history.append({"title": "Mise à jour pour la plateforme anti-programme malveillant de Microsoft Defender - KB4052623 (version 4.18.25100.9)", "date": _iso(now - dt.timedelta(days=20)), "result": 2, "operation": 1, "hresult": 0, "kb": "KB4052623"})
    history.append({"title": "Mise à jour des fonctionnalités vers Windows 11, version 25H2", "date": _iso(now - dt.timedelta(days=300)), "result": 2, "operation": 1, "hresult": 0, "kb": None})
    history = [h for h in history if h["date"] <= _iso(now)]
    enriched = up_mod.enrich(history)
    hotfixes = [{"id": h["kb"], "description": "Security Update", "installedOn": h["date"]}
                for h in enriched if h["kb"] and "cumulative" in h["title"].lower() and h["result"] == 2][:12]
    return {"history": enriched, "hotfixes": hotfixes, "total_history": len(enriched),
            "stats": up_mod.summarize(enriched, hotfixes=hotfixes), "errors": []}


def updates_pending():
    return {"updates": [
        {"title": "2026-11 Mise à jour cumulative pour Windows 11 Version 25H2 pour les systèmes x64 (KB5071234)",
         "kb": "KB5071234", "severity": "Critical", "size": 812 * 1024 ** 2, "downloaded": True, "mandatory": False,
         "categories": ["Security Updates", "Windows 11"]},
        {"title": "NVIDIA - Display - 32.0.15.8180", "kb": "", "severity": "", "size": 790 * 1024 ** 2,
         "downloaded": False, "mandatory": False, "categories": ["Drivers"]},
    ], "errors": [], "checked": _iso(_now())}


def netconfig():
    return {
        "profiles": [{"interface": "Ethernet", "network": "Livebox-A1B2", "category": "Private",
                      "ipv4": "Internet", "ipv6": "Internet"}],
        "dns": [{"interface": "Ethernet", "family": 2, "servers": ["192.168.1.1"]},
                {"interface": "Ethernet", "family": 23, "servers": ["fe80::1"]}],
        "gateways": [{"interface": "Ethernet", "nextHop": "192.168.1.1", "metric": 0}],
        "errors": [],
    }


def patch_system(info: dict) -> dict:
    """Hors Windows : simule les champs Windows du résumé système."""
    from .collectors.system import support_status
    info = dict(info)
    info["windows"] = {"product": "Windows 11 Professionnel", "display_version": "25H2", "edition": "Professional",
                       "build": "26200.7171",
                       "support": support_status("Windows 11 Pro", "25H2", "Professional")}
    info["reboot_pending"] = []
    return info


# --------------------------------------------------------------------------- v1.1 : capteurs et compléments
import math  # noqa: E402
import time  # noqa: E402


def _wave(period, lo, hi, phase=0.0):
    x = (math.sin(time.time() / period + phase) + 1) / 2
    return lo + (hi - lo) * x


class DemoCounters:
    """Imite les compteurs PDH de Windows (charge GPU, fréquence réelle, disques...)."""

    available = {"cpu_perf": True, "gpu_engine": True, "disk_idle": True, "thermal": False}

    def sample(self):
        gpu3d = _wave(23, 3, 55)
        return {
            "cpu_mhz": round(_wave(11, 3700, 4600)),
            "gpus": [{"luid": "0x00000000_0x0001a2b3", "load": round(gpu3d, 1),
                      "engines": {"3D": round(gpu3d, 1), "Décodage vidéo": round(_wave(31, 0, 12), 1), "Copie": 0.4},
                      "dedicated": int(_wave(40, 2.1, 3.4) * GB), "shared": 210 * 1024 ** 2}],
            "gpu": round(gpu3d, 1), "gpu_mem": int(_wave(40, 2.1, 3.4) * GB),
            "disks": [{"name": "0 C:", "busy": round(_wave(7, 0, 18), 1), "latency_ms": 0.4, "queue": 0},
                      {"name": "1 D:", "busy": round(_wave(13, 0, 6), 1), "latency_ms": 9.8, "queue": 0}],
            "disk_busy": round(_wave(7, 0, 18), 1),
            "memory": {"committed": 14.2 * GB, "commit_limit": 36.8 * GB, "cache": 5.1 * GB,
                       "pool_paged": 610 * 1024 ** 2, "pool_nonpaged": 420 * 1024 ** 2, "pages_input": _wave(9, 0, 4)},
            "queue": 0, "handles": 98500, "threads": 2840,
        }

    def close(self):
        pass


def sensors_lhm():
    t1, t2 = _wave(17, 44, 63), _wave(23, 38, 67)
    s = []

    def add(hw, kind, name, stype, value, unit, lo=None, hi=None):
        s.append({"id": f"/{kind}/0/{stype.lower()}/{len(s)}", "name": name, "type": stype, "value": round(value, 1),
                  "min": round(lo if lo is not None else value * 0.7, 1), "max": round(hi if hi is not None else value * 1.25, 1),
                  "unit": unit, "hardware": hw, "kind": kind})

    cpu = "AMD Ryzen 5 5600X"
    add(cpu, "cpu", "Core (Tctl/Tdie)", "Temperature", t1, "°C", 34, 81)
    for i in range(6):
        add(cpu, "cpu", f"Core #{i + 1}", "Clock", _wave(9, 3700, 4650, i), "MHz")
        add(cpu, "cpu", f"Core #{i + 1}", "Load", _wave(5, 2, 40, i), "%")
    add(cpu, "cpu", "Package", "Power", _wave(13, 28, 76), "W", 21, 88)
    add(cpu, "cpu", "Core (SVI2 TFN)", "Voltage", _wave(9, 1.05, 1.42), "V")
    board = "MSI B550-A PRO (MS-7C56)"
    add(board, "board", "CPU Fan", "Fan", _wave(17, 820, 1350), "tr/min")
    add(board, "board", "System Fan #1", "Fan", 640, "tr/min")
    add(board, "board", "System Fan #2", "Fan", 655, "tr/min")
    add(board, "board", "Chipset", "Temperature", 47.0, "°C")
    add(board, "board", "+12V", "Voltage", 12.07, "V")
    gpu = "NVIDIA GeForce RTX 3060"
    add(gpu, "gpu", "GPU Core", "Temperature", t2, "°C", 33, 74)
    add(gpu, "gpu", "GPU Hot Spot", "Temperature", t2 + 11, "°C")
    add(gpu, "gpu", "GPU Core", "Load", _wave(23, 3, 55), "%")
    add(gpu, "gpu", "GPU Package", "Power", _wave(23, 18, 150), "W")
    add(gpu, "gpu", "GPU", "Fan", _wave(23, 0, 1700), "tr/min")
    ram = "Mémoire générique"
    add(ram, "memory", "Memory", "Load", 34.0, "%")
    for disk, temp in (("Samsung SSD 980 PRO 1TB", 41.0), ("ST2000DM008-2FR102", 36.0)):
        add(disk, "storage", "Temperature", "Temperature", temp, "°C")
    hw = [{"name": n, "id": f"/{k}/0", "kind": k} for n, k in
          ((cpu, "cpu"), (board, "board"), (gpu, "gpu"), (ram, "memory"),
           ("Samsung SSD 980 PRO 1TB", "storage"), ("ST2000DM008-2FR102", "storage"))]
    return {"version": "0.9.6", "hardware": hw, "sensors": s}


def sensors_nvidia():
    return [{"name": "NVIDIA GeForce RTX 3060", "temp": round(_wave(23, 38, 67)), "load": round(_wave(23, 3, 55)),
             "mem_load": 12, "mem_used": 2.6 * GB, "mem_total": 12 * GB, "power": round(_wave(23, 18, 150), 1),
             "power_limit": 170.0, "fan": round(_wave(23, 0, 52)), "clock": 1777, "mem_clock": 7501,
             "pstate": "P2", "driver": "581.57"}]


def osinfo():
    now = _now()
    boots = []
    for i in range(12):
        sec = 18 + (i % 4) * 3.5 + (25 if i == 7 else 0)
        boots.append({"time": _iso(now - dt.timedelta(days=30 - i * 2.5)), "bootMs": int(sec * 1000),
                      "mainPathMs": int(sec * 600), "postBootMs": int(sec * 400), "seconds": round(sec, 1)})
    return {
        "activation": {"status": 1, "label": "Activé", "channel": "Retail", "name": "Windows(R), Professional edition"},
        "boots": boots,
        "restore_points": [{"description": "Installed NVIDIA App", "time": _iso(now - dt.timedelta(days=12))},
                           {"description": "Windows Modules Installer", "time": _iso(now - dt.timedelta(days=40))}],
        "timezone": "(UTC+01:00) Bruxelles, Copenhague, Madrid, Paris",
        "power": {"guid": "381b4222-f694-41f0-9685-ff5bb260df2e", "name": "Utilisation normale", "mode": "Équilibré"},
        "minidumps": [],
        "fast_startup": True, "hibernation": True, "firmware": "UEFI",
        "errors": [],
    }


def drivers():
    rows = [
        ("NVIDIA GeForce RTX 3060", "DISPLAY", "NVIDIA", "32.0.15.8157", "2026-09-18", True),
        ("Realtek PCIe 2.5GbE Family Controller", "NET", "Realtek", "10.68.1003.2023", "2023-10-03", True),
        ("Intel(R) Wi-Fi 6 AX200 160MHz", "NET", "Intel", "23.60.1.2", "2024-06-04", True),
        ("Realtek High Definition Audio", "MEDIA", "Realtek Semiconductor Corp.", "6.0.9600.1", "2023-03-16", True),
        ("NVIDIA High Definition Audio", "MEDIA", "NVIDIA Corporation", "1.4.3.2", "2025-02-11", True),
        ("AMD GPIO Controller", "SYSTEM", "Advanced Micro Devices, Inc", "2.2.0.130", "2022-08-17", True),
        ("AMD PSP 11.0 Device", "SECURITYDEVICES", "Advanced Micro Devices Inc.", "5.24.0.0", "2023-04-20", True),
        ("VirtualBox NDIS6 Bridged Networking Driver", "NETSERVICE", "Oracle Corporation", "7.1.4.165100", "2024-10-15", True),
        ("Npcap Packet Driver (NPCAP)", "NET", "Insecure.Com LLC.", "13.51.42.926", "2024-09-26", True),
        ("Logitech G HUB Virtual Bus Enumerator", "SYSTEM", "Logitech", "2023.7.7.0", "2023-07-07", True),
    ]
    return {"total": 412, "drivers": [{"device": d, "class": c, "provider": p, "version": v, "date": f"{date}T00:00:00",
                                       "signed": s, "signer": "Microsoft Windows Hardware Compatibility Publisher", "inf": "oem12.inf"}
                                      for d, c, p, v, date, s in rows], "errors": []}


def scheduled_tasks():
    now = _now()
    rows = [
        ("GoogleUpdateTaskMachineCore", "\\", "Ready", ["Au démarrage", "Quotidien"], r'"C:\Program Files (x86)\Google\Update\GoogleUpdate.exe" /c', "SYSTEM", True),
        ("MicrosoftEdgeUpdateTaskMachineUA", "\\", "Ready", ["Quotidien"], r"C:\Program Files (x86)\Microsoft\EdgeUpdate\MicrosoftEdgeUpdate.exe /ua /installsource scheduler", "SYSTEM", True),
        ("NvTmRep_CrashReport1", "\\NVIDIA\\", "Ready", ["Quotidien"], r"C:\Program Files\NVIDIA Corporation\NvContainer\NvTmRep.exe", "demo", False),
        ("OneDrive Reporting Task", "\\", "Ready", ["Une fois"], r"%localappdata%\Microsoft\OneDrive\OneDriveStandaloneUpdater.exe /reporting", "demo", False),
        ("MSI Task Host - LEDKeeper", "\\", "Disabled", ["À l'ouverture de session"], r"C:\Program Files (x86)\MSI\One Dragon Center\LEDKeeper.exe", "SYSTEM", True),
    ]
    return [{"name": n, "path": p, "state": st, "author": None, "actions": [a], "triggers": tr, "runAs": ra,
             "runLevel": "Highest" if el else "Limited", "elevated": el,
             "lastRun": _iso(now - dt.timedelta(hours=5)), "nextRun": _iso(now + dt.timedelta(hours=19)), "lastResult": 0}
            for n, p, st, tr, a, ra, el in rows]


def wifi():
    return {"ssid": "Livebox-A1B2", "signal": 78, "bssid": "aa:bb:cc:11:22:33", "radio": "802.11ax", "band": "5 GHz",
            "channel": "36", "auth": "WPA3-Personnel", "cipher": "CCMP", "state": "connecté",
            "adapter": "Intel(R) Wi-Fi 6 AX200 160MHz", "rx_rate": 1201.0, "tx_rate": 960.0}
