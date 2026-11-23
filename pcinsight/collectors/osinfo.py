"""Informations système complémentaires : activation, alimentation, démarrage, firmware."""

import ctypes
import datetime as dt
import os
import re
import subprocess

from ..ps import as_list, run_script
from ..winutil import HKLM, IS_WINDOWS, NO_WINDOW, VIEW_64, reg_value

LICENSE = {0: "Non activé", 1: "Activé", 2: "Période de grâce", 3: "Période de grâce",
           4: "Non authentique", 5: "Notification (non activé)", 6: "Période de grâce étendue"}
POWER_PLANS = {
    "381b4222-f694-41f0-9685-ff5bb260df2e": "Utilisation normale",
    "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c": "Performances élevées",
    "a1841308-3541-4fab-bc81-f71556f20b4a": "Économie d'énergie",
    "e9a42b02-d5df-448d-aa00-03f14749eb61": "Performances optimales",
}
# Mode d'alimentation de Windows 11 (curseur « Mode d'alimentation »)
POWER_MODES = {
    "961cc777-2547-4f9d-8174-7d86181b8a7a": "Meilleure efficacité énergétique",
    "00000000-0000-0000-0000-000000000000": "Équilibré",
    "ded574b5-45a0-4f42-8737-46345c09c238": "Meilleures performances",
}
GUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def power_plan() -> dict:
    """Mode de gestion de l'alimentation actif (powercfg, sortie localisée)."""
    try:
        proc = subprocess.run(["powercfg", "/getactivescheme"], capture_output=True, stdin=subprocess.DEVNULL,
                              timeout=10, creationflags=NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    text = proc.stdout.decode("oem" if IS_WINDOWS else "utf-8", errors="replace")
    m = GUID_RE.search(text)
    if not m:
        return {}
    guid = m.group(0).lower()
    name = re.search(r"\(([^)]+)\)", text)
    mode = reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes",
                     "ActiveOverlayAcPowerScheme", None, VIEW_64)
    return {"guid": guid, "name": POWER_PLANS.get(guid) or (name.group(1) if name else guid),
            "mode": POWER_MODES.get(str(mode).lower()) if mode else None}


def minidumps() -> list:
    """Fichiers de vidage créés lors des écrans bleus (lecture parfois réservée aux admins)."""
    folder = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "Minidump")
    try:
        files = [os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith(".dmp")]
    except OSError:
        return []
    out = []
    for f in files:
        try:
            st = os.stat(f)
            out.append({"file": os.path.basename(f), "time": dt.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                        "size": st.st_size})
        except OSError:
            continue
    return sorted(out, key=lambda x: x["time"], reverse=True)[:30]


def firmware_type():
    """1 = BIOS hérité, 2 = UEFI. API GetFirmwareType (Windows 8+), repli sur le registre."""
    if IS_WINDOWS:
        try:
            value = ctypes.c_int(0)
            if ctypes.windll.kernel32.GetFirmwareType(ctypes.byref(value)):
                return value.value
        except (AttributeError, OSError):
            pass
    return reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control", "PEFirmwareType", None, VIEW_64)


def registry_info() -> dict:
    power = r"SYSTEM\CurrentControlSet\Control\Session Manager\Power"
    firmware = firmware_type()
    return {
        "fast_startup": None if (v := reg_value(HKLM, power, "HiberbootEnabled", None, VIEW_64)) is None else v == 1,
        "hibernation": None if (v := reg_value(HKLM, r"SYSTEM\CurrentControlSet\Control\Power", "HibernateEnabled", None, VIEW_64)) is None else v == 1,
        "firmware": {1: "BIOS (hérité)", 2: "UEFI"}.get(firmware),
    }


def collect() -> dict:
    if not IS_WINDOWS:
        raise RuntimeError("Disponible uniquement sous Windows")
    raw = run_script("osinfo", timeout=90)
    act = as_list(raw.get("activation"))
    main = next((a for a in act if a.get("status") == 1), act[0] if act else None)
    boots = sorted(as_list(raw.get("boot")), key=lambda b: b.get("time") or "")
    return {
        "activation": {"status": main.get("status"), "label": LICENSE.get(main.get("status"), "Inconnu"),
                       "channel": main.get("channel"), "name": main.get("name")} if main else None,
        "boots": [{**b, "seconds": round(b["bootMs"] / 1000, 1)} for b in boots if b.get("bootMs")],
        "restore_points": sorted(as_list(raw.get("restorePoints")), key=lambda r: r.get("time") or "", reverse=True),
        "timezone": raw.get("timezone"),
        "power": power_plan(),
        "minidumps": minidumps(),
        **registry_info(),
        "errors": as_list(raw.get("errors")),
    }


def drivers() -> dict:
    if not IS_WINDOWS:
        raise RuntimeError("Disponible uniquement sous Windows")
    raw = run_script("drivers", timeout=120)
    seen, rows = set(), []
    for d in as_list(raw.get("drivers")):
        key = (d.get("device"), d.get("version"))
        if key in seen:
            continue
        seen.add(key)
        rows.append(d)
    rows.sort(key=lambda d: (d.get("class") or "", d.get("device") or ""))
    return {"total": raw.get("total") or 0, "drivers": rows, "errors": as_list(raw.get("errors"))}
