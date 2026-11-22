"""Résumé du système : version de Windows, cycle de support, uptime, redémarrage en attente."""

import datetime as dt
import platform
import time

import psutil

from ..winutil import HKLM, IS_WINDOWS, VIEW_64, is_admin, reg_key_exists, reg_value

CURRENT_VERSION = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"

# Fin des mises à jour de sécurité (source : Microsoft Learn, release information, nov. 2026)
WIN11_END = {
    "home_pro": {
        "21H2": "2023-10-10", "22H2": "2024-10-08", "23H2": "2025-11-11",
        "24H2": "2026-10-13", "25H2": "2027-10-12", "26H2": "2028-10-10",
    },
    "enterprise": {
        "21H2": "2024-10-08", "22H2": "2025-10-14", "23H2": "2026-11-10",
        "24H2": "2027-10-12", "25H2": "2028-10-10", "26H2": "2029-10-09",
    },
}
WIN10_END = "2025-10-14"
ENTERPRISE_EDITIONS = ("Enterprise", "Education", "IoTEnterprise")


def support_status(product: str, display_version: str, edition: str, today=None) -> dict:
    """Indique si la version de Windows reçoit encore des mises à jour de sécurité."""
    today = today or dt.date.today()
    edition = edition or ""
    end = None
    if "EnterpriseS" in edition:  # LTSC : cycle de vie spécifique, non géré
        end = None
    elif "Windows 11" in product:
        family = "enterprise" if edition.startswith(ENTERPRISE_EDITIONS) else "home_pro"
        end = WIN11_END[family].get((display_version or "").upper())
    elif "Windows 10" in product:
        end = WIN10_END
    if not end:
        return {"known": False, "supported": None, "end": None, "days_left": None}
    end_date = dt.date.fromisoformat(end)
    days_left = (end_date - today).days
    return {"known": True, "supported": days_left >= 0, "end": end, "days_left": days_left}


def windows_version() -> dict:
    product = reg_value(HKLM, CURRENT_VERSION, "ProductName", "", VIEW_64) or ""
    build = str(reg_value(HKLM, CURRENT_VERSION, "CurrentBuild", "", VIEW_64) or "")
    ubr = reg_value(HKLM, CURRENT_VERSION, "UBR", None, VIEW_64)
    display = reg_value(HKLM, CURRENT_VERSION, "DisplayVersion", None, VIEW_64) or \
        reg_value(HKLM, CURRENT_VERSION, "ReleaseId", "", VIEW_64)
    edition = reg_value(HKLM, CURRENT_VERSION, "EditionID", "", VIEW_64) or ""
    # Le registre indique toujours « Windows 10 » sur Windows 11 : on corrige via le build
    if build.isdigit() and int(build) >= 22000:
        product = product.replace("Windows 10", "Windows 11")
    full_build = f"{build}.{ubr}" if ubr is not None else build
    return {
        "product": product,
        "display_version": display,
        "edition": edition,
        "build": full_build,
        "support": support_status(product, display, edition),
    }


def reboot_pending() -> list:
    """Raisons pour lesquelles Windows attend un redémarrage."""
    reasons = []
    if reg_key_exists(HKLM, r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired", VIEW_64):
        reasons.append("Windows Update")
    if reg_key_exists(HKLM, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending", VIEW_64):
        reasons.append("Composants Windows (CBS)")
    if reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control\Session Manager", "PendingFileRenameOperations", None, VIEW_64):
        reasons.append("Fichiers à remplacer au démarrage")
    return reasons


def collect() -> dict:
    boot = psutil.boot_time()
    vm = psutil.virtual_memory()
    info = {
        "hostname": platform.node(),
        "platform": platform.platform(),
        "is_windows": IS_WINDOWS,
        "is_admin": is_admin(),
        "boot_time": boot,
        "uptime": time.time() - boot,
        "cpu_logical": psutil.cpu_count() or 0,
        "cpu_physical": psutil.cpu_count(logical=False) or 0,
        "ram_total": vm.total,
        "processor": platform.processor(),
        "python": platform.python_version(),
        "windows": windows_version() if IS_WINDOWS else None,
        "reboot_pending": reboot_pending() if IS_WINDOWS else [],
    }
    return info
