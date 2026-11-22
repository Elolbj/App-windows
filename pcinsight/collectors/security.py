"""État de sécurité : antivirus, pare-feu, UAC, Secure Boot, BitLocker, RDP, SMBv1, comptes."""

from ..ps import as_list, run_script
from ..winutil import HKLM, VIEW_64, reg_key_exists, reg_value

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
    }


def collect() -> dict:
    raw = run_script("security", timeout=60)
    av = []
    for a in as_list(raw.get("antivirus")):
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
        "errors": as_list(raw.get("errors")),
    }
