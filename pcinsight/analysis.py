"""Diagnostic : transforme les données collectées en constats, conseils et score de santé.

Chaque constat a une gravité (critical, warning, info, good) et une pénalité. Le score
d'une catégorie vaut 100 moins la somme de ses pénalités ; le score global est la
moyenne des catégories pour lesquelles des données existent."""

import datetime as dt

CATEGORIES = {
    "performance": "Performances",
    "storage": "Stockage",
    "security": "Sécurité",
    "stability": "Stabilité",
    "updates": "Mises à jour",
}
PENALTY = {"critical": 25, "warning": 10, "info": 3, "good": 0}
GB = 1024 ** 3


def _fmt_bytes(n):
    return f"{n / GB:.1f} Go".replace(".", ",")


def _fmt_date(iso):
    try:
        return dt.date.fromisoformat(str(iso)[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return str(iso)


class Report:
    def __init__(self):
        self.findings = []
        self.covered = set()

    def add(self, category, severity, title, detail="", advice="", penalty=None):
        self.covered.add(category)
        self.findings.append({
            "category": category, "severity": severity, "title": title, "detail": detail,
            "advice": advice, "penalty": PENALTY[severity] if penalty is None else penalty,
        })

    def result(self):
        scores = {}
        for key, label in CATEGORIES.items():
            if key not in self.covered:
                scores[key] = {"label": label, "score": None}
                continue
            lost = sum(f["penalty"] for f in self.findings if f["category"] == key)
            scores[key] = {"label": label, "score": max(0, 100 - lost)}
        values = [s["score"] for s in scores.values() if s["score"] is not None]
        order = {"critical": 0, "warning": 1, "info": 2, "good": 3}
        self.findings.sort(key=lambda f: (order[f["severity"]], -f["penalty"]))
        counts = {s: sum(1 for f in self.findings if f["severity"] == s) for s in order}
        return {
            "score": round(sum(values) / len(values)) if values else None,
            "categories": scores,
            "findings": self.findings,
            "counts": counts,
            "generated": dt.datetime.now().isoformat(timespec="seconds"),
        }


# ---------------------------------------------------------------------------- règles

def check_performance(r: Report, system, live, history, software, hardware):
    if live:
        ram_pct = 100 * (1 - live["ram_available"] / live["ram_total"]) if live.get("ram_total") else 0
        if ram_pct >= 90:
            r.add("performance", "warning", "Mémoire vive presque saturée",
                  f"{ram_pct:.0f} % de la RAM est utilisée en ce moment.",
                  "Fermez les applications inutiles (navigateur, onglets) ou ajoutez de la RAM.")
    stats = (history or {}).get("stats") or {}
    if stats.get("minutes", 0) >= 60:
        if stats["ram_avg"] >= 85:
            r.add("performance", "warning", "RAM souvent saturée",
                  f"Utilisation moyenne de {stats['ram_avg']:.0f} % sur les dernières 24 h enregistrées.",
                  "Windows utilise alors le fichier d'échange (disque), ce qui ralentit le PC.")
        if stats["cpu_avg"] >= 60:
            r.add("performance", "warning", "Processeur très sollicité",
                  f"Charge moyenne de {stats['cpu_avg']:.0f} % sur 24 h.",
                  "Identifiez le processus responsable dans l'onglet Performances.")
        elif stats["cpu_high_minutes"] >= 60:
            r.add("performance", "info", "Pics de charge CPU fréquents",
                  f"{stats['cpu_high_minutes']} minutes au-dessus de 80 % sur 24 h.")
    if system:
        days = system.get("uptime", 0) / 86400
        if days >= 30:
            r.add("performance", "warning", "PC allumé depuis plus d'un mois",
                  f"Dernier redémarrage il y a {days:.0f} jours.",
                  "Redémarrez : certaines mises à jour et libérations de mémoire n'ont lieu qu'au redémarrage.")
        elif days >= 7:
            r.add("performance", "info", "Redémarrage conseillé",
                  f"Le PC n'a pas redémarré depuis {days:.0f} jours (la mise en veille prolongée ne compte pas).",
                  "« Arrêter » avec le démarrage rapide activé ne remet pas le noyau à zéro : utilisez « Redémarrer ».")
        if system.get("ram_total", 0) and system["ram_total"] < 7.5 * GB:
            r.add("performance", "info", "Quantité de RAM limitée",
                  f"{_fmt_bytes(system['ram_total'])} installés.",
                  "8 Go est un minimum confortable sous Windows 11, 16 Go pour le jeu ou le développement.")
    if software:
        n = software["stats"]["startup_enabled"]
        if n >= 15:
            r.add("performance", "warning", "Trop de programmes au démarrage",
                  f"{n} programmes se lancent avec Windows.",
                  "Désactivez les inutiles : Gestionnaire des tâches > Applications de démarrage.")
        elif n >= 8:
            r.add("performance", "info", "Programmes au démarrage nombreux", f"{n} programmes actifs au démarrage.")
        else:
            r.add("performance", "good", "Démarrage léger", f"{n} programme(s) au démarrage.")
    if hardware:
        modules = (hardware.get("memory") or {}).get("modules") or []
        slow = [m for m in modules if m.get("speed") and m.get("configuredSpeed") and m["configuredSpeed"] < m["speed"]]
        if slow:
            m = slow[0]
            r.add("performance", "info", "Mémoire sous sa fréquence nominale",
                  f"La RAM tourne à {m['configuredSpeed']} MT/s alors qu'elle supporte {m['speed']} MT/s.",
                  "Activez le profil XMP / EXPO / DOCP dans le BIOS (gain gratuit, surtout en jeu).")
        slots = (hardware.get("memory") or {}).get("slots") or 0
        if len(modules) == 1 and slots >= 2 and (hardware.get("system") or {}).get("pcSystemType") != 2:
            r.add("performance", "info", "Mémoire en simple canal",
                  "Une seule barrette est installée.",
                  "Une 2e barrette identique active le double canal et double la bande passante mémoire.")
        for b in hardware.get("battery") or []:
            if b.get("health") is not None and b["health"] < 70:
                r.add("performance", "warning", "Batterie usée",
                      f"Capacité réelle : {b['health']:.0f} % de la capacité d'origine.",
                      "Une batterie sous 70 % justifie un remplacement si l'autonomie gêne.")
    if live and not any(f["category"] == "performance" and f["severity"] in ("warning", "critical")
                        for f in r.findings):
        r.add("performance", "good", "Pas de saturation détectée", "CPU et mémoire dans des niveaux normaux.")


def check_storage(r: Report, storage, hardware):
    if storage:
        for p in storage.get("partitions", []):
            if p.get("removable") or not p.get("total") or p["total"] < GB:
                continue  # amovible ou petite partition technique
            free_pct = 100 * p["free"] / p["total"]
            name = f"{p['mount']}" + (f" ({p['label']})" if p.get("label") else "")
            if free_pct < 10 or p["free"] < 5 * GB:
                sev = "critical" if p.get("system") else "warning"
                r.add("storage", sev, f"Espace disque critique sur {name}",
                      f"{_fmt_bytes(p['free'])} libres ({free_pct:.0f} %).",
                      "Lancez « Nettoyage de disque » (cleanmgr) ou Paramètres > Stockage > Assistant Stockage.")
            elif free_pct < 20:
                r.add("storage", "warning" if p.get("system") else "info", f"Espace disque faible sur {name}",
                      f"{_fmt_bytes(p['free'])} libres ({free_pct:.0f} %).",
                      "Gardez au moins 15-20 % libres sur le disque système pour les mises à jour.")
        temp = sum(t["size"] for t in storage.get("temp", []))
        if temp >= 3 * GB:
            r.add("storage", "info", "Fichiers temporaires volumineux",
                  f"{_fmt_bytes(temp)} dans les dossiers temporaires.",
                  "Supprimez-les via Paramètres > Système > Stockage > Fichiers temporaires.")
    if hardware:
        for d in hardware.get("disks", []):
            if d.get("health") in (1, 2):
                r.add("storage", "critical", f"Disque en mauvaise santé : {d.get('name')}",
                      f"Windows signale l'état « {d.get('health_label')} ».",
                      "Sauvegardez vos données immédiatement et prévoyez son remplacement.")
            rel = d.get("reliability") or {}
            if rel.get("wear") is not None and rel["wear"] >= 80:
                r.add("storage", "warning", f"SSD très usé : {d.get('name')}",
                      f"Usure estimée à {rel['wear']} %.", "Surveillez-le et sauvegardez régulièrement.")
            if rel.get("temperature") and rel["temperature"] >= 65:
                r.add("storage", "warning", f"Disque chaud : {d.get('name')}",
                      f"{rel['temperature']} °C mesurés.", "Vérifiez la ventilation du boîtier ou du portable.")
            if d.get("media") == "HDD" and d.get("bus") != "USB":
                r.add("storage", "info", f"Disque dur mécanique : {d.get('name')}",
                      "Les HDD sont 20 à 50 fois plus lents qu'un SSD en accès aléatoire.",
                      "Si c'est le disque système, un SSD SATA d'occasion ou neuf transformera le PC.")
        if not any(f["category"] == "storage" and f["severity"] in ("warning", "critical") for f in r.findings):
            r.add("storage", "good", "Stockage en bon état", "Espace libre suffisant et disques sains.")


def check_security(r: Report, security, network):
    if not security:
        return
    d = security.get("defender") or {}
    third_party = [a for a in security.get("antivirus", []) if "defender" not in (a.get("name") or "").lower()]
    active_av = [a for a in security.get("antivirus", []) if a.get("enabled")]
    if d:
        if d.get("realTime"):
            r.add("security", "good", "Protection en temps réel active", "Microsoft Defender surveille le système.")
        elif any(a.get("enabled") for a in third_party):
            r.add("security", "good", "Antivirus tiers actif", ", ".join(a["name"] for a in third_party if a.get("enabled")))
        else:
            r.add("security", "critical", "Aucune protection antivirus en temps réel",
                  "Defender est désactivé et aucun autre antivirus actif n'est détecté.",
                  "Réactivez-la : Sécurité Windows > Protection contre les virus et menaces.")
        age = d.get("signatureAge")
        if d.get("realTime") and age is not None and 3 <= age < 10000:
            r.add("security", "warning" if age >= 7 else "info", "Définitions antivirus anciennes",
                  f"Dernière mise à jour des signatures il y a {age} jours.",
                  "Lancez Windows Update ou « Rechercher des mises à jour » dans Sécurité Windows.")
        if d.get("realTime") and d.get("tamperProtected") is False:
            r.add("security", "info", "Protection contre les falsifications désactivée",
                  "Un logiciel malveillant pourrait modifier les réglages de Defender.",
                  "Sécurité Windows > Paramètres de protection > Protection contre les falsifications.")
    elif not active_av:
        r.add("security", "warning", "État de l'antivirus inconnu", "Impossible de lire l'état de Defender.")

    fw = security.get("firewall") or []
    off = [f["label"] for f in fw if not f.get("enabled")]
    if fw and off:
        sev = "critical" if "Public" in off else "warning"
        r.add("security", sev, "Pare-feu désactivé", f"Profil(s) désactivé(s) : {', '.join(off)}.",
              "Réactivez le pare-feu : Sécurité Windows > Pare-feu et protection du réseau.")
    elif fw:
        r.add("security", "good", "Pare-feu actif", "Tous les profils réseau sont protégés.")

    reg = security.get("registry") or {}
    if reg.get("uac_enabled") is False:
        r.add("security", "critical", "Contrôle de compte d'utilisateur (UAC) désactivé",
              "Tout programme lancé obtient directement les droits administrateur.",
              "Réactivez l'UAC (EnableLUA = 1) puis redémarrez.")
    elif reg.get("uac_never_notify"):
        r.add("security", "warning", "UAC réglé sur « Ne jamais m'avertir »",
              "Les élévations de privilèges se font sans confirmation.",
              "Panneau de configuration > Comptes d'utilisateurs > Modifier les paramètres de contrôle.")
    if reg.get("smb1_client") or reg.get("smb1_server"):
        r.add("security", "warning", "SMBv1 activé",
              "Protocole obsolète exploité par WannaCry/NotPetya (EternalBlue).",
              "Désactivez-le : Fonctionnalités de Windows > Support de partage de fichiers SMB 1.0.")
    if reg.get("rdp_enabled"):
        sev = "warning" if reg.get("rdp_nla") is False else "info"
        r.add("security", sev, "Bureau à distance activé",
              "Le port 3389 accepte des connexions entrantes."
              + (" L'authentification NLA est désactivée." if reg.get("rdp_nla") is False else ""),
              "Désactivez-le si vous ne l'utilisez pas ; sinon gardez NLA et un mot de passe robuste.")
    if reg.get("secure_boot") is False:
        r.add("security", "info", "Secure Boot désactivé",
              "Le démarrage sécurisé UEFI protège contre les bootkits.", "Activez-le dans le BIOS/UEFI si possible.")
    elif reg.get("secure_boot"):
        r.add("security", "good", "Secure Boot actif", "Le démarrage est vérifié par l'UEFI.")

    sys_drive = next((b for b in security.get("bitlocker", []) if (b.get("drive") or "").upper() == "C:"), None)
    if sys_drive and sys_drive.get("code") == 2:
        r.add("security", "info", "Disque système non chiffré",
              "En cas de vol, les données du disque sont lisibles en le branchant sur un autre PC.",
              "Activez BitLocker (Pro) ou le « Chiffrement de l'appareil » (Famille, si disponible).")

    users = security.get("users") or []
    if any(u.get("guest") and u.get("enabled") for u in users):
        r.add("security", "warning", "Compte Invité activé", "", "Désactivez-le : net user Invité /active:no")
    no_pwd = [u["name"] for u in users if u.get("enabled") and not u.get("passwordRequired")
              and not u.get("guest") and not u.get("builtin_admin")]
    if no_pwd:
        r.add("security", "info", "Compte(s) sans mot de passe obligatoire", ", ".join(no_pwd[:5]),
              "Un compte sans mot de passe est accessible à quiconque a accès au PC.")

    if network:
        sensitive = [p for p in (network.get("connections") or {}).get("listening", []) if p.get("sensitive")]
        ports = sorted({p["port"] for p in sensitive})
        if ports:
            r.add("security", "info", "Ports sensibles ouverts sur le réseau",
                  ", ".join(f"{p}" for p in ports) + " en écoute sur toutes les interfaces.",
                  "Normal sur un PC Windows (RPC/SMB), mais vérifiez qu'ils ne sont pas exposés sur un réseau public.",
                  penalty=0)


def check_stability(r: Report, events, hardware):
    if events:
        st = events["stats"]
        kinds = st.get("incident_counts", {})
        days = st.get("days", 30)
        bsod = kinds.get("bsod", 0)
        if bsod:
            r.add("stability", "critical", f"{bsod} écran(s) bleu(s) en {days} jours",
                  "Le système a planté (BugCheck).",
                  "Cause fréquente : pilote ou RAM. Testez la RAM (mdsched) et mettez à jour les pilotes.")
        reboots = kinds.get("unexpected_reboot", 0) + kinds.get("unexpected_shutdown", 0)
        if reboots:
            sev = "critical" if reboots >= 5 else "warning"
            r.add("stability", sev, f"{reboots} arrêt(s) inattendu(s) en {days} jours",
                  "Coupure de courant, bouton maintenu, gel ou surchauffe.",
                  "Si ce n'était pas volontaire : vérifiez l'alimentation et les températures.")
        if kinds.get("hardware"):
            r.add("stability", "critical", "Erreurs matérielles (WHEA)",
                  f"{kinds['hardware']} erreur(s) signalée(s) par le processeur, la RAM ou le bus PCIe.",
                  "Revenez aux réglages par défaut si vous avez overclocké et testez la RAM.")
        if kinds.get("disk"):
            r.add("stability", "critical", "Erreurs disque dans les journaux",
                  f"{kinds['disk']} événement(s) disque/NTFS (secteurs défectueux, corruption).",
                  "Sauvegardez puis lancez « chkdsk C: /scan » dans un terminal administrateur.")
        crashes = kinds.get("app_crash", 0) + kinds.get("app_hang", 0)
        if crashes:
            top = st.get("crash_apps") or []
            names = ", ".join(f"{n} ({c})" for n, c in top[:3])
            sev = "warning" if crashes >= 10 else "info"
            r.add("stability", sev, f"{crashes} plantage(s) ou blocage(s) d'applications",
                  f"Les plus touchées : {names}." if names else "",
                  "Mettez à jour ou réinstallez les applications concernées.")
        if kinds.get("low_memory"):
            r.add("stability", "warning", "Manque de mémoire détecté",
                  f"Windows a signalé {kinds['low_memory']} fois une mémoire virtuelle insuffisante.",
                  "Laissez Windows gérer la taille du fichier d'échange et/ou ajoutez de la RAM.")
        rel = st.get("reliability_last")
        if rel is not None:
            if rel < 5:
                r.add("stability", "warning", "Indice de fiabilité bas",
                      f"Indice de stabilité Windows : {rel:.1f}/10.",
                      "Détails : Panneau de configuration > Moniteur de fiabilité (perfmon /rel).")
            elif rel >= 8:
                r.add("stability", "good", "Système stable", f"Indice de stabilité Windows : {rel:.1f}/10.")
        if not bsod and not reboots and not kinds.get("hardware") and not kinds.get("disk"):
            r.add("stability", "good", "Aucun plantage système", f"Pas d'écran bleu ni d'arrêt brutal en {days} jours.")
    if hardware:
        problems = [p for p in hardware.get("problem_devices", []) if not p.get("disabled")]
        if problems:
            r.add("stability", "warning", f"{len(problems)} périphérique(s) en erreur",
                  "; ".join(f"{p.get('name') or p.get('deviceId')} : {p['label']}" for p in problems[:4]),
                  "Gestionnaire de périphériques (devmgmt.msc) : mettez à jour ou réinstallez le pilote.")


def check_updates(r: Report, system, updates):
    win = (system or {}).get("windows") or {}
    support = win.get("support") or {}
    if support.get("known"):
        name = f"{win.get('product')} {win.get('display_version') or ''}".strip()
        if not support["supported"]:
            r.add("updates", "critical", "Version de Windows plus prise en charge",
                  f"{name} ne reçoit plus de correctifs de sécurité depuis le {_fmt_date(support['end'])}.",
                  "Installez la dernière version via Windows Update (mise à jour des fonctionnalités, gratuite).")
        elif support["days_left"] <= 90:
            r.add("updates", "warning", "Fin de support proche",
                  f"{name} : fin des correctifs le {_fmt_date(support['end'])} (dans {support['days_left']} jours).",
                  "Prévoyez la mise à jour vers la version suivante.")
        else:
            r.add("updates", "good", "Version de Windows prise en charge",
                  f"{name} : correctifs jusqu'au {_fmt_date(support['end'])}.")
    pending = (system or {}).get("reboot_pending") or []
    if pending:
        r.add("updates", "warning", "Redémarrage en attente",
              "Demandé par : " + ", ".join(pending) + ".",
              "Redémarrez pour terminer l'installation des mises à jour.")
    if updates:
        st = updates["stats"]
        days = st.get("days_since_quality")
        if days is None:
            if st.get("total"):
                r.add("updates", "info", "Aucune mise à jour cumulative dans l'historique",
                      "L'historique Windows Update ne contient pas de mise à jour cumulative.")
        elif days > 60:
            r.add("updates", "critical", "Windows n'est plus mis à jour",
                  f"Dernière mise à jour cumulative installée il y a {days} jours.",
                  "Paramètres > Windows Update > Rechercher des mises à jour.")
        elif days > 40:
            r.add("updates", "warning", "Mises à jour en retard",
                  f"Dernière mise à jour cumulative il y a {days} jours (Microsoft en publie une par mois).",
                  "Paramètres > Windows Update > Rechercher des mises à jour.")
        else:
            r.add("updates", "good", "Windows à jour", f"Dernière mise à jour cumulative il y a {days} jours.")
        unresolved = st.get("unresolved_failed") or []
        if unresolved:
            codes = ", ".join(sorted({u["error"]["hex"] for u in unresolved if u["error"]["hex"]}))
            r.add("updates", "warning", f"{len(unresolved)} échec(s) de mise à jour non résolu(s)",
                  f"Sur les 30 derniers jours. Codes : {codes or 'inconnus'}.",
                  "Utilisez l'utilitaire de résolution des problèmes Windows Update ou "
                  "« DISM /Online /Cleanup-Image /RestoreHealth » puis « sfc /scannow ».")
    if updates and updates.get("pending") is not None:
        n = len(updates["pending"])
        if n:
            r.add("updates", "info", f"{n} mise(s) à jour disponible(s)", "", "Installez-les depuis Windows Update.")


def analyze(data: dict) -> dict:
    """`data` contient les sections disponibles (une section absente vaut None)."""
    r = Report()
    check_performance(r, data.get("system"), data.get("live"), data.get("history"),
                      data.get("software"), data.get("hardware"))
    check_storage(r, data.get("storage"), data.get("hardware"))
    check_security(r, data.get("security"), data.get("network"))
    check_stability(r, data.get("events"), data.get("hardware"))
    check_updates(r, data.get("system"), data.get("updates"))
    return r.result()
