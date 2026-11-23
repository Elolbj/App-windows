"""Logiciels installés (registre), applications du Store, programmes au démarrage, services."""

import datetime as dt
import os
from collections import Counter

import psutil

from ..ps import as_list, run_script
from ..winutil import HKCU, HKLM, IS_WINDOWS, VIEW_32, VIEW_64, reg_subkeys, reg_values

UNINSTALL = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
RUN_KEYS = [r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce"]
APPROVED = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved"


def parse_install_date(value):
    """InstallDate est normalement au format AAAAMMJJ (mais pas toujours)."""
    if not value:
        return None
    s = str(value).strip()
    for fmt in ("%Y%m%d", "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            d = dt.datetime.strptime(s[:10], fmt).date()
            if 1995 <= d.year <= dt.date.today().year + 1:
                return d.isoformat()
        except ValueError:
            continue
    return None


def installed_programs() -> list:
    sources = [(HKLM, VIEW_64, "Machine", "64 bits"), (HKLM, VIEW_32, "Machine", "32 bits"),
               (HKCU, 0, "Utilisateur", "")]
    seen = {}
    for root, view, scope, arch in sources:
        for sub in reg_subkeys(root, UNINSTALL, view):
            v = reg_values(root, f"{UNINSTALL}\\{sub}", view)
            name = (v.get("DisplayName") or "").strip()
            if not name or v.get("SystemComponent") == 1 or v.get("ParentKeyName"):
                continue  # composants système et mises à jour rattachées à un produit
            if str(v.get("ReleaseType", "")).lower() in ("update", "hotfix", "security update"):
                continue
            version = str(v.get("DisplayVersion") or "").strip()
            key = (name.lower(), version)
            if key in seen:
                continue
            size_kb = v.get("EstimatedSize")
            seen[key] = {
                "name": name,
                "version": version,
                "publisher": (v.get("Publisher") or "").strip(),
                "install_date": parse_install_date(v.get("InstallDate")),
                "size": int(size_kb) * 1024 if isinstance(size_kb, int) and size_kb > 0 else None,
                "location": (v.get("InstallLocation") or "").strip(),
                "scope": scope,
                "arch": arch,
            }
    return sorted(seen.values(), key=lambda p: p["name"].lower())


def _approved_state(values: dict, name: str):
    """StartupApproved : 1er octet pair = activé, impair = désactivé."""
    data = values.get(name)
    if isinstance(data, (bytes, bytearray)) and data:
        return data[0] % 2 == 0
    return True


def startup_items() -> list:
    items = []
    for root, hive in ((HKLM, "HKLM"), (HKCU, "HKCU")):
        views = (VIEW_64, VIEW_32) if root == HKLM else (0,)
        approved_run = reg_values(root, APPROVED + r"\Run", VIEW_64 if root == HKLM else 0)
        approved_run32 = reg_values(root, APPROVED + r"\Run32", VIEW_64 if root == HKLM else 0)
        for view in views:
            for key in RUN_KEYS:
                approved = approved_run32 if view == VIEW_32 else approved_run
                location = hive + "\\" + key.rsplit("\\", 1)[-1] + (" (32 bits)" if view == VIEW_32 else "")
                for name, command in reg_values(root, key, view).items():
                    if not name:
                        continue
                    items.append({
                        "name": name,
                        "command": str(command),
                        "location": location,
                        "enabled": _approved_state(approved, name),
                    })
    folders = []
    if os.environ.get("APPDATA"):
        folders.append((os.path.join(os.environ["APPDATA"], r"Microsoft\Windows\Start Menu\Programs\Startup"), HKCU))
    if os.environ.get("PROGRAMDATA"):
        folders.append((os.path.join(os.environ["PROGRAMDATA"], r"Microsoft\Windows\Start Menu\Programs\StartUp"), HKLM))
    for folder, root in folders:
        if not os.path.isdir(folder):
            continue
        approved = reg_values(root, APPROVED + r"\StartupFolder", VIEW_64 if root == HKLM else 0)
        for entry in os.listdir(folder):
            if entry.lower() == "desktop.ini":
                continue
            items.append({
                "name": os.path.splitext(entry)[0],
                "command": os.path.join(folder, entry),
                "location": "Dossier Démarrage",
                "enabled": _approved_state(approved, entry),
            })
    # dédoublonnage (même entrée vue dans les vues 32 et 64 bits)
    unique = {}
    for it in items:
        unique.setdefault((it["name"].lower(), it["command"].lower()), it)
    return sorted(unique.values(), key=lambda i: i["name"].lower())


def is_third_party(binpath: str) -> bool:
    """Service dont l'exécutable n'est pas dans le dossier Windows (logiciel installé)."""
    p = (binpath or "").lower().replace('"', "")
    windir = os.environ.get("SystemRoot", r"C:\Windows").lower()
    system_prefixes = (windir, "%systemroot%", "%windir%", "\\systemroot\\", "system32\\")
    # les composants Microsoft hors du dossier Windows (Defender, Edge, Office) ne sont pas « tiers »
    return bool(p) and not p.startswith(system_prefixes) and "\\microsoft" not in p


def services() -> list:
    if not IS_WINDOWS:
        return []
    out = []
    for s in psutil.win_service_iter():
        try:
            binpath = s.binpath()
        except (psutil.Error, OSError):
            binpath = ""
        try:
            out.append({
                "name": s.name(),
                "display_name": s.display_name(),
                "status": s.status(),
                "start_type": s.start_type(),
                "user": s.username(),
                "binpath": binpath,
                "third_party": is_third_party(binpath),
            })
        except (psutil.Error, OSError):
            continue
    return sorted(out, key=lambda s: s["display_name"].lower())


TRIGGERS = {"Logon": "À l'ouverture de session", "Boot": "Au démarrage", "Time": "Une fois", "Daily": "Quotidien",
            "Weekly": "Hebdomadaire", "Monthly": "Mensuel", "Idle": "Inactivité", "Event": "Sur événement",
            "Registration": "À la création", "SessionStateChange": "Changement de session"}


def scheduled_tasks() -> dict:
    """Tâches planifiées hors \\Microsoft\\ : un emplacement classique pour la persistance."""
    try:
        raw = run_script("tasks", timeout=90)
    except Exception as exc:
        return {"tasks": [], "errors": [str(exc)]}
    tasks = []
    for t in as_list(raw.get("tasks")):
        trig = []
        for name in as_list(t.get("triggers")):
            key = str(name).replace("MSFT_Task", "").replace("Trigger", "")
            trig.append(TRIGGERS.get(key, key))
        last = t.get("lastRun")
        tasks.append({
            **t,
            "actions": as_list(t.get("actions")),
            "triggers": trig,
            "lastRun": last if last and last >= "2001" else None,  # 1999-11-30 = jamais exécutée
            "elevated": t.get("runLevel") == "Highest",
        })
    tasks.sort(key=lambda t: (t.get("path") or "") + (t.get("name") or ""))
    return {"tasks": tasks, "errors": as_list(raw.get("errors"))}


def store_apps() -> dict:
    try:
        raw = run_script("appx", timeout=60)
    except Exception as exc:  # non bloquant
        return {"apps": [], "errors": [str(exc)]}
    apps = [a for a in as_list(raw.get("apps")) if a.get("signature") == "Store"]
    return {"apps": sorted(apps, key=lambda a: (a.get("name") or "").lower()),
            "errors": as_list(raw.get("errors"))}


def summarize(programs: list, startup: list, svc: list) -> dict:
    """Statistiques affichées dans les graphiques de la page Logiciels."""
    publishers = Counter(p["publisher"] or "(inconnu)" for p in programs)
    by_month = Counter(p["install_date"][:7] for p in programs if p["install_date"])
    sized = sorted((p for p in programs if p["size"]), key=lambda p: p["size"], reverse=True)
    status = Counter(s["status"] for s in svc)
    start_types = Counter(s["start_type"] for s in svc)
    return {
        "count": len(programs),
        "total_size": sum(p["size"] or 0 for p in programs),
        "with_size": len(sized),
        "top_publishers": publishers.most_common(10),
        "largest": [{"name": p["name"], "size": p["size"]} for p in sized[:10]],
        "installs_by_month": sorted(by_month.items()),
        "arch": Counter(p["arch"] or "Utilisateur" for p in programs).most_common(),
        "startup_enabled": sum(1 for s in startup if s["enabled"]),
        "startup_total": len(startup),
        "services_status": status.most_common(),
        "services_start": start_types.most_common(),
        "auto_stopped": sum(1 for s in svc if s["start_type"] == "automatic" and s["status"] == "stopped"),
        "third_party_services": sum(1 for s in svc if s.get("third_party")),
    }


def collect() -> dict:
    if not IS_WINDOWS:
        raise RuntimeError("Inventaire logiciel disponible uniquement sous Windows")
    programs = installed_programs()
    startup = startup_items()
    svc = services()
    store = store_apps()
    tasks = scheduled_tasks()
    return {
        "programs": programs,
        "startup": startup,
        "services": svc,
        "store": store["apps"],
        "tasks": tasks["tasks"],
        "stats": summarize(programs, startup, svc),
        "errors": store["errors"] + tasks["errors"],
    }
