"""Historique Windows Update : catégories, échecs, rythme des mises à jour."""

import datetime as dt
import re
from collections import Counter

from ..ps import as_list, run_script

RESULTS = {1: "En cours", 2: "Réussie", 3: "Réussie avec erreurs", 4: "Échec", 5: "Annulée"}
OPERATIONS = {1: "Installation", 2: "Désinstallation", 3: "Autre"}

# Codes d'erreur Windows Update fréquents (HRESULT)
HRESULTS = {
    0x80070002: "Fichier introuvable (cache Windows Update incomplet)",
    0x80070005: "Accès refusé",
    0x80070422: "Service Windows Update désactivé",
    0x80070643: "Échec de l'installation (souvent la partition de récupération WinRE trop petite)",
    0x800F0922: "Partition réservée au système pleine ou connexion VPN active",
    0x800F081F: "Source des composants introuvable (réparer avec DISM)",
    0x800F0831: "Paquet de base manquant (réparer avec DISM)",
    0x80073712: "Magasin de composants endommagé (DISM /RestoreHealth)",
    0x8024402C: "Impossible de joindre le serveur (proxy, DNS ou connexion)",
    0x80244022: "Serveur Windows Update indisponible",
    0x80240017: "Mise à jour non applicable à ce PC",
    0x8024200D: "Téléchargement incomplet",
    0x80242016: "Mise à jour interrompue",
    0x80246007: "Téléchargement échoué",
    0x8007000E: "Mémoire insuffisante",
    0x80070070: "Espace disque insuffisant",
}

# L'ordre compte : la première expression qui correspond l'emporte
CATEGORIES = [
    (r"intelligence|veille de s[ée]curit[ée]|definition|d[ée]finition", "Définitions antivirus"),
    (r"antimalware|anti-programme|plateforme|platform", "Plateforme Defender"),
    (r"malicious software removal|logiciels malveillants|KB890830", "Outil anti-malware (MSRT)"),
    (r"servicing stack|pile de maintenance", "Pile de maintenance"),
    (r"\.net", ".NET Framework"),
    (r"office|microsoft 365|onenote|outlook", "Microsoft Office"),
    (r"feature update|mise à jour des fonctionnalit|enablement package", "Mise à jour de fonctionnalités"),
    (r"cumulative|security update|mise à jour de sécurité", "Mise à jour cumulative"),
    (r"\bedge\b", "Microsoft Edge"),
]
DRIVER_RE = re.compile(r"^[^-]{2,60} - [^-]{2,60} - .+")


def categorize(title: str) -> str:
    t = (title or "").lower()
    for pattern, label in CATEGORIES:
        if re.search(pattern, t, re.I):
            return label
    if DRIVER_RE.match(title or "") or "driver" in t or "pilote" in t:
        return "Pilote"
    return "Autre"


def hresult_info(hr) -> dict:
    if not hr:
        return {"hex": None, "label": None}
    code = int(hr) & 0xFFFFFFFF
    return {"hex": f"0x{code:08X}", "label": HRESULTS.get(code)}


def summarize(history: list, now=None) -> dict:
    now = now or dt.datetime.now()
    ok = [h for h in history if h["result"] in (2, 3)]
    failed = [h for h in history if h["result"] in (4, 5)]

    def last_date(items):
        dates = [h["date"] for h in items if h.get("date")]
        return max(dates) if dates else None

    quality = [h for h in ok if h["category"] in ("Mise à jour cumulative", "Mise à jour de fonctionnalités")]
    last_quality = last_date(quality)
    days_since_quality = None
    if last_quality:
        days_since_quality = (now - dt.datetime.fromisoformat(last_quality)).days

    months = []
    y, m = now.year, now.month
    for _ in range(12):
        months.append(f"{y:04d}-{m:02d}")
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    months.reverse()
    per_month = {mo: {"success": 0, "failed": 0} for mo in months}
    for h in history:
        mo = (h.get("date") or "")[:7]
        if mo in per_month and h["result"] in (2, 3):
            per_month[mo]["success"] += 1
        elif mo in per_month and h["result"] in (4, 5):
            per_month[mo]["failed"] += 1

    recent_cut = (now - dt.timedelta(days=30)).isoformat()
    recent_failed = [h for h in failed if (h.get("date") or "") >= recent_cut]
    # Un échec suivi d'une réussite pour la même KB (ou le même titre) est considéré comme résolu
    last_ok = {}
    for h in ok:
        key = h.get("kb") or h.get("title")
        last_ok[key] = max(last_ok.get(key, ""), h.get("date") or "")
    unresolved = [h for h in recent_failed
                  if last_ok.get(h.get("kb") or h.get("title"), "") < (h.get("date") or "")]

    return {
        "total": len(history),
        "succeeded": len(ok),
        "failed": len(failed),
        "success_rate": round(100 * len(ok) / len(history), 1) if history else None,
        "last_success": last_date(ok),
        "last_quality": last_quality,
        "days_since_quality": days_since_quality,
        "per_month": [{"month": mo, **v} for mo, v in per_month.items()],
        "by_category": Counter(h["category"] for h in history).most_common(),
        "recent_failed": len(recent_failed),
        "unresolved_failed": unresolved[:20],
        "error_codes": Counter(h["error"]["hex"] for h in failed if h["error"]["hex"]).most_common(8),
    }


def enrich(history: list) -> list:
    out = []
    for h in history:
        out.append({
            **h,
            "category": categorize(h.get("title")),
            "result_label": RESULTS.get(h.get("result"), "Inconnu"),
            "operation_label": OPERATIONS.get(h.get("operation"), "Autre"),
            "error": hresult_info(h.get("hresult")) if h.get("result") in (3, 4, 5) else {"hex": None, "label": None},
        })
    out.sort(key=lambda h: h.get("date") or "", reverse=True)
    return out


def collect() -> dict:
    raw = run_script("updates", timeout=120)
    history = enrich(as_list(raw.get("history")))
    hotfixes = sorted(as_list(raw.get("hotfixes")), key=lambda h: h.get("installedOn") or "", reverse=True)
    return {
        "history": history,
        "hotfixes": hotfixes,
        "total_history": raw.get("total") or len(history),
        "stats": summarize(history),
        "errors": as_list(raw.get("errors")),
    }


def pending() -> dict:
    raw = run_script("updates_pending", timeout=600)
    updates = as_list(raw.get("updates"))
    for u in updates:
        u["categories"] = as_list(u.get("categories"))
    return {"updates": updates, "errors": as_list(raw.get("errors")), "checked": dt.datetime.now().isoformat(timespec="seconds")}
