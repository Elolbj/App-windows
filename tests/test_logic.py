"""Tests de la logique indépendante de Windows (analyse, statistiques, décodages)."""

import datetime as dt
import time

from pcinsight import analysis, demo
from pcinsight.collectors import events, software, system, updates
from pcinsight.collectors.security import decode_av_state
from pcinsight.history import History, percentile

GB = 1024 ** 3


# ----------------------------------------------------------------- version de Windows
def test_support_status_windows11_home_pro_and_enterprise():
    today = dt.date(2026, 11, 22)
    s = system.support_status("Windows 11 Pro", "24H2", "Professional", today)
    assert s["known"] and not s["supported"] and s["end"] == "2026-10-13"
    s = system.support_status("Windows 11 Enterprise", "24H2", "Enterprise", today)
    assert s["supported"] and s["end"] == "2027-10-12"
    s = system.support_status("Windows 11 Famille", "25H2", "Core", today)
    assert s["supported"] and s["days_left"] > 300


def test_support_status_windows10_and_ltsc():
    today = dt.date(2026, 11, 22)
    assert system.support_status("Windows 10 Pro", "22H2", "Professional", today)["supported"] is False
    assert system.support_status("Windows 10 Enterprise LTSC", "21H2", "EnterpriseS", today)["known"] is False
    assert system.support_status("Windows 11 Pro", "99H9", "Professional", today)["known"] is False


# ----------------------------------------------------------------- décodages
def test_decode_av_state():
    assert decode_av_state(397568) == {"enabled": True, "up_to_date": True}     # Defender actif
    assert decode_av_state(393472) == {"enabled": False, "up_to_date": True}    # Defender désactivé
    assert decode_av_state(397584) == {"enabled": True, "up_to_date": False}    # signatures périmées


def test_software_helpers():
    assert software.parse_install_date("20240315") == "2024-03-15"
    assert software.parse_install_date("15/03/2024") == "2024-03-15"
    assert software.parse_install_date("n'importe quoi") is None
    assert software.parse_install_date("19000101") is None
    assert software._approved_state({"App": b"\x02\x00"}, "App") is True
    assert software._approved_state({"App": b"\x03\x00"}, "App") is False
    assert software._approved_state({}, "Absent") is True


def test_update_categories_and_errors():
    assert updates.categorize("2026-11 Cumulative Update for Windows 11 Version 25H2 (KB5070001)") == "Mise à jour cumulative"
    assert updates.categorize("2026-11 Cumulative Update for .NET Framework 3.5 and 4.8.1 (KB5070002)") == ".NET Framework"
    assert updates.categorize("Security Intelligence Update for Microsoft Defender Antivirus - KB2267602") == "Définitions antivirus"
    assert updates.categorize("Intel Corporation - Extension - 10.1.19.2") == "Pilote"
    info = updates.hresult_info(-2146498270)
    assert info["hex"] == "0x800F0922" and "VPN" in info["label"]


def test_updates_unresolved_failures():
    now = dt.datetime(2026, 11, 22, 12)
    hist = updates.enrich([
        {"title": "A (KB1)", "kb": "KB1", "date": "2026-11-10T10:00:00", "result": 4, "operation": 1, "hresult": -2145124329},
        {"title": "A (KB1)", "kb": "KB1", "date": "2026-11-12T10:00:00", "result": 2, "operation": 1, "hresult": 0},
        {"title": "B (KB2)", "kb": "KB2", "date": "2026-11-15T10:00:00", "result": 4, "operation": 1, "hresult": -2145124329},
    ])
    st = updates.summarize(hist, now)
    assert st["failed"] == 2 and st["recent_failed"] == 2
    assert [u["kb"] for u in st["unresolved_failed"]] == ["KB2"]  # KB1 a été réinstallée ensuite


# ----------------------------------------------------------------- événements
def test_events_summary_detects_incidents():
    now = dt.datetime(2026, 11, 22, 12)
    evs = [
        {"time": "2026-11-21T10:00:00", "level": 1, "id": 41, "source": "Microsoft-Windows-Kernel-Power", "message": "x"},
        {"time": "2026-11-21T09:00:00", "level": 2, "id": 1000, "source": "Application Error", "app": "game.exe"},
        {"time": "2026-11-20T09:00:00", "level": 2, "id": 1000, "source": "Application Error", "app": "game.exe"},
        {"time": "2026-11-20T08:00:00", "level": 2, "id": 7, "source": "disk", "message": "bad block"},
        {"time": "2026-11-19T08:00:00", "level": 3, "id": 10016, "source": "Microsoft-Windows-DistributedCOM"},
    ]
    st = events.summarize(evs, [], [{"time": "2026-11-21T00:00:00", "index": 4.2}], 7, now)
    assert st["incident_counts"] == {"unexpected_reboot": 1, "app_crash": 2, "disk": 1}
    assert st["crash_apps"] == [("game.exe", 2)]
    assert st["levels"] == {"Critique": 1, "Erreur": 3, "Avertissement": 1}
    assert len(st["per_day"]) == 7 and st["per_day"][-1]["date"] == "2026-11-22"
    assert st["reliability_last"] == 4.2


# ----------------------------------------------------------------- historique
def test_history_aggregates_per_minute(tmp_path):
    h = History(tmp_path / "h.db")
    base = int(time.time() // 60 * 60) - 180
    for i in range(3 * 30):  # 3 minutes, un point toutes les 2 s
        h.add({"t": base + i * 2, "cpu": 50.0 if i < 30 else 90.0, "ram": 40.0, "swap": 0.0,
               "disk_r": 1000.0, "disk_w": 0.0, "net_up": 10.0, "net_down": 20.0})
    h.flush()
    q = h.query("1h")
    assert q["stats"]["minutes"] == 3
    assert round(q["stats"]["cpu_max"]) == 90
    assert q["stats"]["cpu_high_minutes"] == 2
    assert q["stats"]["net_down"] == 20.0 * 60 * 3
    h.close()


def test_percentile():
    assert percentile([1, 2, 3, 4, 5], 50) == 3
    assert percentile([], 95) is None


# ----------------------------------------------------------------- analyse
def _demo_data():
    sysinfo = demo.patch_system({"uptime": 3600, "ram_total": 32 * GB})
    return {
        "system": sysinfo, "hardware": demo.hardware(), "software": demo.software(), "security": demo.security(),
        "events": demo.events(), "updates": demo.updates(), "network": None,
        "storage": {"partitions": [{"mount": "C:\\", "label": "", "removable": False, "system": True,
                                    "total": 500 * GB, "used": 480 * GB, "free": 20 * GB, "percent": 96}], "temp": []},
        "live": {"ram_total": 32 * GB, "ram_available": 20 * GB},
    }


def test_analysis_on_demo_data():
    res = analysis.analyze(_demo_data())
    titles = [f["title"] for f in res["findings"]]
    assert any("Espace disque critique" in t for t in titles)       # 4 % libres sur C:
    assert res["categories"]["storage"]["score"] <= 75
    assert 0 <= res["score"] <= 100
    severities = [f["severity"] for f in res["findings"]]
    order = {"critical": 0, "warning": 1, "info": 2, "good": 3}
    assert severities == sorted(severities, key=order.get)          # tri par gravité


def test_analysis_security_rules():
    data = _demo_data()
    sec = data["security"]
    sec["defender"]["realTime"] = False
    sec["antivirus"] = [{"name": "Windows Defender", "enabled": False, "up_to_date": True}]
    sec["registry"]["uac_enabled"] = False
    sec["registry"]["smb1_client"] = True
    sec["firewall"][2]["enabled"] = False
    res = analysis.analyze(data)
    crit = {f["title"] for f in res["findings"] if f["severity"] == "critical"}
    assert "Aucune protection antivirus en temps réel" in crit
    assert "Pare-feu désactivé" in crit
    assert any("UAC" in t for t in crit)
    assert any(f["title"] == "SMBv1 activé" for f in res["findings"])


def test_analysis_ram_rules():
    data = _demo_data()
    mods = data["hardware"]["memory"]["modules"]
    mods[0]["configuredSpeed"] = 2133
    data["hardware"]["memory"]["modules"] = mods[:1]
    titles = [f["title"] for f in analysis.analyze(data)["findings"]]
    assert "Mémoire sous sa fréquence nominale" in titles
    assert "Mémoire en simple canal" in titles


def test_analysis_without_data():
    res = analysis.analyze({})
    assert res["score"] is None and res["findings"] == []


def test_updates_hotfix_fallback():
    now = dt.datetime(2026, 11, 22, 12)
    st = updates.summarize([], now, hotfixes=[{"id": "KB1", "installedOn": "2026-08-01T00:00:00"},
                                              {"id": "KB2", "installedOn": None}])
    assert st["last_hotfix"] == "2026-08-01T00:00:00" and st["days_since_hotfix"] == 113
    res = analysis.analyze({"updates": {"stats": st}})
    assert any(f["title"] == "Windows n'est plus mis à jour" and "correctif" in f["detail"] for f in res["findings"])
