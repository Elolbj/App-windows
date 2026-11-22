"""Journaux d'événements Windows : statistiques, plantages, arrêts inattendus, fiabilité."""

import datetime as dt
from collections import Counter

from ..ps import as_list, run_script

LEVELS = {1: "Critique", 2: "Erreur", 3: "Avertissement"}

# Événements remarquables : (source contient, ID) -> catégorie
INCIDENTS = [
    ("Microsoft-Windows-Kernel-Power", 41, "unexpected_reboot", "Redémarrage inattendu (coupure, gel ou écran bleu)"),
    ("EventLog", 6008, "unexpected_shutdown", "Arrêt inattendu du système"),
    ("Microsoft-Windows-WER-SystemErrorReporting", 1001, "bsod", "Écran bleu (BugCheck)"),
    ("BugCheck", 1001, "bsod", "Écran bleu (BugCheck)"),
    ("Microsoft-Windows-WHEA-Logger", None, "hardware", "Erreur matérielle signalée (WHEA)"),
    ("disk", 7, "disk", "Secteur défectueux détecté sur un disque"),
    ("disk", 51, "disk", "Erreur lors d'une opération de pagination disque"),
    ("disk", 153, "disk", "Opération disque relancée (délai dépassé)"),
    ("Ntfs", 55, "disk", "Structure du système de fichiers corrompue"),
    ("Microsoft-Windows-Ntfs", 55, "disk", "Structure du système de fichiers corrompue"),
    ("Ntfs", 98, "disk", "Volume à réparer (chkdsk)"),
    ("Microsoft-Windows-Ntfs", 98, "disk", "Volume à réparer (chkdsk)"),
    ("Application Error", 1000, "app_crash", "Plantage d'application"),
    ("Application Hang", 1002, "app_hang", "Application bloquée (ne répond pas)"),
    ("Microsoft-Windows-Resource-Exhaustion-Detector", 2004, "low_memory", "Mémoire virtuelle insuffisante"),
    ("volmgr", 161, "dump", "Échec de création du fichier de vidage mémoire"),
]


def classify(source: str, event_id: int):
    src = (source or "").lower()
    for name, eid, kind, label in INCIDENTS:
        if src == name.lower() and (eid is None or eid == event_id):
            return kind, label
    return None, None


def summarize(events: list, boots: list, reliability: list, days: int, now=None) -> dict:
    now = now or dt.datetime.now()
    start = (now - dt.timedelta(days=days - 1)).date()
    per_day = {(start + dt.timedelta(days=i)).isoformat(): {1: 0, 2: 0, 3: 0} for i in range(days)}
    levels = Counter()
    sources = Counter()
    groups = {}
    incidents = []
    crash_apps = Counter()
    kinds = Counter()

    for e in events:
        level = e.get("level") or 3
        day = (e.get("time") or "")[:10]
        if day in per_day and level in per_day[day]:
            per_day[day][level] += 1
        levels[level] += 1
        sources[e.get("source") or "?"] += 1

        key = (e.get("source"), e.get("id"))
        g = groups.get(key)
        if not g:
            g = groups[key] = {"source": e.get("source"), "id": e.get("id"), "level": level,
                               "count": 0, "last": e.get("time"), "first": e.get("time"),
                               "message": e.get("message")}
        g["count"] += 1
        g["first"] = e.get("time")  # liste triée du plus récent au plus ancien
        g["level"] = min(g["level"], level)
        if not g["message"] and e.get("message"):
            g["message"] = e["message"]

        kind, label = classify(e.get("source"), e.get("id"))
        if kind:
            kinds[kind] += 1
            e["kind"] = kind
            if kind in ("app_crash", "app_hang"):
                crash_apps[(e.get("app") or "?").strip()] += 1
            else:
                incidents.append({"time": e.get("time"), "kind": kind, "label": label,
                                  "source": e.get("source"), "id": e.get("id"), "message": e.get("message")})

    boot_days = Counter((b.get("time") or "")[:10] for b in boots if b.get("id") == 6005)
    rel = sorted(reliability, key=lambda r: r.get("time") or "")
    top_groups = sorted(groups.values(), key=lambda g: g["count"], reverse=True)

    return {
        "days": days,
        "total": len(events),
        "levels": {LEVELS[k]: levels.get(k, 0) for k in LEVELS},
        "per_day": [{"date": d, "critical": v[1], "error": v[2], "warning": v[3]} for d, v in per_day.items()],
        "top_sources": sources.most_common(10),
        "top_groups": top_groups[:25],
        "incidents": incidents[:100],
        "incident_counts": dict(kinds),
        "crash_apps": crash_apps.most_common(10),
        "boots": len([b for b in boots if b.get("id") == 6005]),
        "boots_per_day": sorted(boot_days.items()),
        "reliability": rel,
        "reliability_last": rel[-1]["index"] if rel else None,
    }


def collect(days=30) -> dict:
    raw = run_script("events", timeout=180, Days=days)
    events = as_list(raw.get("events"))
    boots = as_list(raw.get("boots"))
    reliability = as_list(raw.get("reliability"))
    return {
        "events": events,
        "truncated": bool(raw.get("truncated")),
        "stats": summarize(events, boots, reliability, days),
        "errors": as_list(raw.get("errors")),
    }


def daily_average(stats: dict, level_key="error") -> float:
    days = stats.get("per_day") or []
    return sum(d[level_key] for d in days) / len(days) if days else 0.0

