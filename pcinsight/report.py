"""Export d'un rapport HTML autonome (imprimable / PDF) et des données brutes en JSON."""

import datetime as dt
import html
import json
from pathlib import Path

from . import APP_NAME, __version__

SEVERITY = {"critical": ("Critique", "#d03b3b"), "warning": ("Attention", "#c27c00"),
            "info": ("Info", "#2a78d6"), "good": ("OK", "#0ca30c")}


def _e(value) -> str:
    return html.escape("" if value is None else str(value))


def _bytes(n) -> str:
    if not n:
        return "—"
    for unit in ("o", "Ko", "Mo", "Go", "To"):
        if abs(n) < 1024 or unit == "To":
            return f"{n:.1f} {unit}".replace(".", ",") if unit != "o" else f"{n} o"
        n /= 1024
    return str(n)


def _table(headers, rows) -> str:
    if not rows:
        return "<p class='muted'>Aucune donnée.</p>"
    head = "".join(f"<th>{_e(h)}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{_e(c)}</td>" for c in row) + "</tr>" for row in rows)
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def _kv(pairs) -> str:
    return "<dl>" + "".join(f"<dt>{_e(k)}</dt><dd>{_e(v)}</dd>" for k, v in pairs if v not in (None, "")) + "</dl>"


def build_html(data: dict) -> str:
    system = data.get("system") or {}
    win = system.get("windows") or {}
    analysis = data.get("analysis") or {}
    hw = data.get("hardware") or {}
    storage = data.get("storage") or {}
    sec = data.get("security") or {}
    upd = data.get("updates") or {}
    ev = data.get("events") or {}
    sw = data.get("software") or {}
    osi = data.get("osinfo") or {}
    sens = data.get("sensors") or {}
    now = dt.datetime.now().strftime("%d/%m/%Y à %H:%M")

    parts = [f"<h1>Rapport {APP_NAME}</h1><p class='muted'>{_e(system.get('hostname'))} — généré le {now}</p>"]

    score = analysis.get("score")
    cats = "".join(f"<li>{_e(c['label'])} : <b>{_e(c['score'] if c['score'] is not None else '—')}</b></li>"
                   for c in (analysis.get("categories") or {}).values())
    parts.append(f"<h2>Score de santé : {_e(score if score is not None else '—')}/100</h2><ul class='cats'>{cats}</ul>")

    rows = []
    for f in analysis.get("findings") or []:
        label, color = SEVERITY.get(f["severity"], ("", "#888"))
        rows.append(f"<tr><td><span class='badge' style='background:{color}'>{label}</span></td>"
                    f"<td><b>{_e(f['title'])}</b><br><span class='muted'>{_e(f['detail'])}</span></td>"
                    f"<td>{_e(f['advice'])}</td></tr>")
    parts.append("<h2>Diagnostic</h2><table><thead><tr><th>Niveau</th><th>Constat</th><th>Conseil</th></tr></thead>"
                 f"<tbody>{''.join(rows)}</tbody></table>")

    cpu = (hw.get("cpu") or [{}])[0]
    gpu = ", ".join(g.get("name") or "" for g in hw.get("gpu") or [])
    mem = hw.get("memory") or {}
    parts.append("<h2>Système et matériel</h2>" + _kv([
        ("Windows", f"{win.get('product', '')} {win.get('display_version') or ''} (build {win.get('build', '')})"),
        ("Modèle", f"{(hw.get('system') or {}).get('manufacturer', '')} {(hw.get('system') or {}).get('model', '')}"),
        ("Processeur", cpu.get("name")),
        ("Cœurs / threads", f"{cpu.get('cores', '')} / {cpu.get('threads', '')}" if cpu else None),
        ("Carte graphique", gpu),
        ("Mémoire", f"{_bytes(mem.get('total') or system.get('ram_total'))} ({len(mem.get('modules') or [])} barrette(s))"),
        ("Carte mère", f"{(hw.get('board') or {}).get('manufacturer', '')} {(hw.get('board') or {}).get('product', '')}"),
        ("BIOS", (hw.get("bios") or {}).get("version")),
        ("Firmware", osi.get("firmware")),
        ("Activation", (osi.get("activation") or {}).get("label")),
        ("Mode d'alimentation", (osi.get("power") or {}).get("name")),
        ("Démarrage rapide", {True: "Activé", False: "Désactivé"}.get(osi.get("fast_startup"))),
    ]))
    if sens:
        labels = {"cpu_temp": "Température CPU (°C)", "gpu_temp": "Température GPU (°C)", "gpu_load": "Charge GPU (%)",
                  "cpu_power": "Puissance CPU (W)", "gpu_power": "Puissance GPU (W)", "fan_max": "Ventilateur le plus rapide (tr/min)",
                  "disk_temp": "Disque le plus chaud (°C)"}
        parts.append("<h2>Capteurs (au moment de l'export)</h2>" + _kv(
            [(labels.get(k, k), f"{v['value']} — {v['source']}") for k, v in sens.items()]))

    parts.append("<h2>Stockage</h2>" + _table(
        ["Volume", "Nom", "Système de fichiers", "Taille", "Libre", "Utilisé"],
        [[p["mount"], p.get("label"), p.get("fstype"), _bytes(p["total"]), _bytes(p["free"]), f"{p['percent']:.0f} %"]
         for p in storage.get("partitions") or []]))
    parts.append(_table(["Disque", "Type", "Interface", "Taille", "Santé"],
                        [[d.get("name"), d.get("media"), d.get("bus"), _bytes(d.get("size")), d.get("health_label")]
                         for d in hw.get("disks") or []]))

    d = sec.get("defender") or {}
    reg = sec.get("registry") or {}
    yes_no = {True: "Oui", False: "Non", None: "Inconnu"}
    parts.append("<h2>Sécurité</h2>" + _kv([
        ("Protection en temps réel (Defender)", yes_no.get(d.get("realTime"))),
        ("Âge des signatures", f"{d.get('signatureAge')} jour(s)" if d else None),
        ("Pare-feu", ", ".join(f"{f['label']} : {'actif' if f['enabled'] else 'désactivé'}" for f in sec.get("firewall") or [])),
        ("UAC", yes_no.get(reg.get("uac_enabled"))),
        ("Secure Boot", yes_no.get(reg.get("secure_boot"))),
        ("Bureau à distance", yes_no.get(reg.get("rdp_enabled"))),
        ("BitLocker", ", ".join(f"{b['drive']} {b['label']}" for b in sec.get("bitlocker") or [])),
    ]))

    st = upd.get("stats") or {}
    parts.append("<h2>Mises à jour</h2>" + _kv([
        ("Dernière mise à jour cumulative", st.get("last_quality")),
        ("Mises à jour dans l'historique", st.get("total")),
        ("Échecs", st.get("failed")),
    ]) + _table(["Date", "Mise à jour", "Résultat"],
                [[h.get("date", "")[:10], h.get("title"), h.get("result_label")] for h in (upd.get("history") or [])[:25]]))

    es = ev.get("stats") or {}
    parts.append(f"<h2>Événements ({_e(es.get('days', 30))} derniers jours)</h2>" + _kv(
        [(k, v) for k, v in (es.get("levels") or {}).items()]) + _table(
        ["Source", "ID", "Occurrences", "Dernière", "Message"],
        [[g.get("source"), g.get("id"), g.get("count"), (g.get("last") or "")[:16].replace("T", " "),
          (g.get("message") or "")[:160]] for g in (es.get("top_groups") or [])[:15]]))

    tasks = sw.get("tasks") or []
    if tasks:
        parts.append(f"<h2>Tâches planifiées hors Microsoft ({len(tasks)})</h2>" + _table(
            ["Tâche", "État", "Déclencheurs", "Action"],
            [[(t.get("path") or "") + (t.get("name") or ""), t.get("state"), ", ".join(t.get("triggers") or []),
              " ; ".join(t.get("actions") or [])[:200]] for t in tasks]))

    parts.append(f"<h2>Logiciels installés ({len(sw.get('programs') or [])})</h2>" + _table(
        ["Nom", "Version", "Éditeur", "Installé le", "Taille"],
        [[p["name"], p.get("version"), p.get("publisher"), p.get("install_date"), _bytes(p.get("size"))]
         for p in sw.get("programs") or []]))

    style = """
      body{font-family:system-ui,'Segoe UI',sans-serif;color:#0b0b0b;background:#fff;max-width:1100px;margin:32px auto;padding:0 16px;font-size:14px}
      h1{margin-bottom:4px} h2{margin-top:32px;border-bottom:1px solid #e1e0d9;padding-bottom:6px}
      table{border-collapse:collapse;width:100%;margin:8px 0} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e1e0d9;vertical-align:top}
      th{background:#f4f4f1} .muted{color:#52514e} dl{display:grid;grid-template-columns:260px 1fr;gap:4px 16px}
      dt{color:#52514e} dd{margin:0} .badge{color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;white-space:nowrap}
      ul.cats{display:flex;gap:24px;list-style:none;padding:0;flex-wrap:wrap}
      @media print{body{margin:0}}"""
    return (f"<!doctype html><html lang='fr'><head><meta charset='utf-8'><title>Rapport {APP_NAME}</title>"
            f"<style>{style}</style></head><body>{''.join(parts)}"
            f"<p class='muted'>{APP_NAME} {__version__}</p></body></html>")


def export(data: dict, folder: Path) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y-%m-%d_%H%M")
    html_path = folder / f"Rapport_PC_{stamp}.html"
    json_path = folder / f"Donnees_PC_{stamp}.json"
    html_path.write_text(build_html(data), encoding="utf-8")
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return {"html": str(html_path), "json": str(json_path), "folder": str(folder)}
