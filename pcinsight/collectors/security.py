"""État de sécurité : antivirus, pare-feu, UAC, Secure Boot, BitLocker, RDP, SMBv1, comptes."""

import os

from ..ps import as_list, run_script
from ..winutil import HKCU, HKLM, VIEW_64, reg_key_exists, reg_value

POLICIES = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"

# System.Volume.BitLockerProtection (propriété du Shell)
BITLOCKER = {0: "Non chiffrable", 1: "Activé", 2: "Désactivé", 3: "Chiffrement en cours",
             4: "Déchiffrement en cours", 5: "Suspendu", 6: "Activé (verrouillé)", 8: "En attente d'activation"}
FIREWALL_NAMES = {"Domain": "Domaine", "Private": "Privé", "Public": "Public"}


def decode_av_state(state: int) -> dict:
    """productState du Centre de sécurité : octet 2 = activé (0x10), octet 1 = signatures (0x00 = à jour)."""
    state = int(state or 0)
    return {
        "enabled": bool((state >> 8) & 0x10),
        "up_to_date": (state & 0xFF) == 0,
    }


def registry_checks() -> dict:
    lua = reg_value(HKLM, POLICIES, "EnableLUA", None, VIEW_64)
    consent = reg_value(HKLM, POLICIES, "ConsentPromptBehaviorAdmin", None, VIEW_64)
    deny_rdp = reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control\Terminal Server", "fDenyTSConnections", None, VIEW_64)
    nla = reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp",
                    "UserAuthentication", None, VIEW_64)
    secure_boot = reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control\SecureBoot\State",
                            "UEFISecureBootEnabled", None, VIEW_64)
    smb1_server = reg_value(HKLM, r"SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters", "SMB1", None, VIEW_64)
    smb1_driver = reg_key_exists(HKLM, r"SYSTEM\CurrentControlSet\Services\mrxsmb10", VIEW_64)
    smb1_start = reg_value(HKLM, r"SYSTEM\CurrentControlSet\Services\mrxsmb10", "Start", None, VIEW_64)
    lsa_ppl = reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control\Lsa", "RunAsPPL", None, VIEW_64)
    vbs = reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control\DeviceGuard", "EnableVirtualizationBasedSecurity", None, VIEW_64)
    hvci = reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity",
                     "Enabled", None, VIEW_64)
    return {
        "uac_enabled": None if lua is None else lua == 1,
        "uac_never_notify": consent == 0 if consent is not None else None,
        "rdp_enabled": None if deny_rdp is None else deny_rdp == 0,
        "rdp_nla": None if nla is None else nla == 1,
        "secure_boot": None if secure_boot is None else secure_boot == 1,
        "smb1_client": smb1_driver and smb1_start != 4,
        "smb1_server": smb1_server == 1,
        "vbs": None if vbs is None else vbs == 1,
        "memory_integrity": None if hvci is None else hvci == 1,
        "lsa_protection": None if lsa_ppl is None else lsa_ppl in (1, 2),
    }


def hosts_entries() -> list:
    """Lignes actives du fichier hosts (une redirection de domaine peut cacher un détournement)."""
    path = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "drivers", "etc", "hosts")
    out = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.split("#", 1)[0].strip()
                parts = line.split()
                if len(parts) >= 2:
                    out.append({"ip": parts[0], "names": parts[1:]})
    except OSError:
        pass
    return out[:200]


def proxy_settings() -> dict:
    key = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
    return {
        "enabled": reg_value(HKCU, key, "ProxyEnable", 0) == 1,
        "server": reg_value(HKCU, key, "ProxyServer", None),
        "pac": reg_value(HKCU, key, "AutoConfigURL", None),
    }


def clean_exclusions(raw) -> dict:
    """Sans droits admin, Windows renvoie « N/A: Must be an administrator... » au lieu de la liste."""
    if not raw:
        return {"visible": False, "paths": [], "processes": [], "extensions": []}
    hidden = any(str(v).startswith("N/A") for k in ("paths", "processes", "extensions") for v in as_list(raw.get(k)))
    pick = lambda k: [v for v in as_list(raw.get(k)) if v and not str(v).startswith("N/A")]  # noqa: E731
    return {"visible": not hidden, "paths": pick("paths"), "processes": pick("processes"), "extensions": pick("extensions")}


def collect() -> dict:
    raw = run_script("security", timeout=60)
    av = []
    for a in as_list(raw.get("antivirus")):
        if not a.get("name"):
            continue  # entrée vide renvoyée par certaines éditions (Windows Server)
        av.append({"name": a.get("name"), **decode_av_state(a.get("state"))})

    firewall = []
    for f in as_list(raw.get("firewall")):
        firewall.append({**f, "label": FIREWALL_NAMES.get(f.get("name"), f.get("name"))})

    bitlocker = []
    for b in as_list(raw.get("bitlocker")):
        code = b.get("protection")
        bitlocker.append({"drive": b.get("drive"), "code": code,
                          "label": BITLOCKER.get(code, "Inconnu" if code is None else f"État {code}"),
                          "on": code in (1, 3, 6)})

    users = as_list(raw.get("users"))
    for u in users:
        sid = u.get("sid") or ""
        u["builtin_admin"] = sid.endswith("-500")
        u["guest"] = sid.endswith("-501")

    return {
        "defender": raw.get("defender"),
        "antivirus": av,
        "firewall": firewall,
        "bitlocker": bitlocker,
        "tpm": raw.get("tpm"),
        "users": users,
        "admins": as_list(raw.get("admins")),
        "registry": registry_checks(),
        "exclusions": clean_exclusions(raw.get("exclusions")),
        "hosts": hosts_entries(),
        "proxy": proxy_settings(),
        "errors": as_list(raw.get("errors")),
    }
