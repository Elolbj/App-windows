"""Partitions, espace disque et taille des fichiers temporaires."""

import ctypes
import os
import time

import psutil

from ..winutil import IS_WINDOWS


def _volume_label(mount: str):
    if not IS_WINDOWS:
        return None
    buf = ctypes.create_unicode_buffer(261)
    ok = ctypes.windll.kernel32.GetVolumeInformationW(
        ctypes.c_wchar_p(mount), buf, 261, None, None, None, None, 0)
    return buf.value if ok else None


def partitions() -> list:
    out = []
    system_drive = (os.environ.get("SystemDrive", "C:") + "\\").upper()
    for p in psutil.disk_partitions(all=False):
        opts = p.opts or ""
        if "cdrom" in opts or (IS_WINDOWS and not p.fstype):
            continue  # lecteur optique ou volume sans média
        if not IS_WINDOWS and (p.mountpoint.startswith(("/snap", "/boot/efi")) or p.fstype == "squashfs"):
            continue
        try:
            u = psutil.disk_usage(p.mountpoint)
        except (OSError, PermissionError):
            continue
        out.append({
            "device": p.device,
            "mount": p.mountpoint,
            "fstype": p.fstype,
            "label": _volume_label(p.mountpoint),
            "removable": "removable" in opts,
            "system": p.mountpoint.upper() == system_drive if IS_WINDOWS else p.mountpoint == "/",
            "total": u.total,
            "used": u.used,
            "free": u.free,
            "percent": u.percent,
        })
    return out


def folder_size(path: str, budget_s=3.0, max_files=50000) -> dict:
    """Taille approximative d'un dossier, avec limite de temps pour rester réactif."""
    total = files = 0
    start = time.time()
    complete = True
    stack = [path]
    while stack:
        if time.time() - start > budget_s or files > max_files:
            complete = False
            break
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                for entry in it:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        else:
                            total += entry.stat(follow_symlinks=False).st_size
                            files += 1
                    except OSError:
                        continue
        except OSError:
            continue
    return {"path": path, "size": total, "files": files, "complete": complete}


def temp_folders() -> list:
    paths = []
    for var in ("TEMP", "TMP"):
        p = os.environ.get(var)
        if p and os.path.isdir(p) and p not in paths:
            paths.append(p)
    if IS_WINDOWS:
        win_temp = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "Temp")
        if os.path.isdir(win_temp):
            paths.append(win_temp)
    return [folder_size(p) for p in paths[:3]]


def collect() -> dict:
    parts = partitions()
    fixed = [p for p in parts if not p["removable"]]
    return {
        "partitions": parts,
        "total": sum(p["total"] for p in fixed),
        "used": sum(p["used"] for p in fixed),
        "free": sum(p["free"] for p in fixed),
        "temp": temp_folders(),
    }
