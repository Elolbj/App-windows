"""Auto-test : exécute chaque collecteur réel, l'analyse et le serveur, puis affiche un bilan.

Utilisé par l'intégration continue sur un runner Windows (python -m pcinsight --selftest)."""

import json
import sys
import time
import urllib.error
import urllib.request

from . import analysis
from .api import SECTIONS, TTL, Api, build_collectors
from .collectors import performance
from .collectors.performance import Sampler
from .history import History
from .server import AppServer
from .store import Store
from .winutil import IS_WINDOWS, app_data_dir, resource_dir


def _summary(name, data):
    """Quelques indicateurs par section pour vérifier que les données sont plausibles."""
    if not isinstance(data, dict):
        return {}
    pick = {
        "system": lambda d: {"windows": d.get("windows"), "admin": d.get("is_admin"), "reboot": d.get("reboot_pending")},
        "hardware": lambda d: {"cpu": [c.get("name") for c in d.get("cpu", [])], "gpu": [g.get("name") for g in d.get("gpu", [])],
                               "ram_modules": len(d.get("memory", {}).get("modules", [])),
                               "disks": [(x.get("name"), x.get("media"), x.get("bus")) for x in d.get("disks", [])],
                               "problems": len(d.get("problem_devices", []))},
        "storage": lambda d: {"partitions": [(p["mount"], p["percent"]) for p in d.get("partitions", [])],
                              "temp": [(t["path"], t["size"]) for t in d.get("temp", [])]},
        "software": lambda d: {"programs": len(d.get("programs", [])), "startup": len(d.get("startup", [])),
                               "services": len(d.get("services", [])), "store": len(d.get("store", [])),
                               "third_party_services": sum(1 for x in d.get("services", []) if x.get("third_party")),
                               "tasks": [(t.get("path"), t.get("name"), t.get("triggers")) for t in d.get("tasks", [])[:6]],
                               "sample": [p["name"] for p in d.get("programs", [])[:5]]},
        "network": lambda d: {"interfaces": [i["name"] for i in d.get("interfaces", [])][:6],
                              "listening": len(d.get("connections", {}).get("listening", []))},
        "netconfig": lambda d: {"profiles": d.get("profiles"), "gateways": len(d.get("gateways") or [])},
        "security": lambda d: {"defender": d.get("defender"), "av": d.get("antivirus"), "firewall": d.get("firewall"),
                               "registry": d.get("registry"), "users": len(d.get("users", [])),
                               "exclusions": d.get("exclusions"), "hosts": d.get("hosts"), "proxy": d.get("proxy")},
        "events": lambda d: {"count": len(d.get("events", [])), "levels": d.get("stats", {}).get("levels"),
                             "top": d.get("stats", {}).get("top_sources", [])[:5],
                             "reliability_points": len(d.get("stats", {}).get("reliability", [])),
                             "sample_message": next((e.get("message") for e in d.get("events", []) if e.get("message")), None)},
        "osinfo": lambda d: {"activation": d.get("activation"), "power": d.get("power"), "boots": d.get("boots", [])[-3:],
                             "firmware": d.get("firmware"), "fast_startup": d.get("fast_startup"),
                             "restore_points": len(d.get("restore_points") or []), "timezone": d.get("timezone")},
        "drivers": lambda d: {"total": d.get("total"), "third_party": len(d.get("drivers", [])),
                              "sample": [(x.get("device"), x.get("provider"), x.get("date")) for x in d.get("drivers", [])[:4]]},
        "updates": lambda d: {"history": len(d.get("history", [])), "hotfixes": len(d.get("hotfixes", [])),
                              "categories": d.get("stats", {}).get("by_category"),
                              "last_quality": d.get("stats", {}).get("last_quality")},
    }.get(name)
    summary = pick(data) if pick else {}
    summary["script_errors"] = data.get("errors") or (data.get("config", {}) or {}).get("errors")
    return summary


def _request(url, token=None, host=None):
    req = urllib.request.Request(url)
    if token:
        req.add_header("X-Token", token)
    if host:
        req.add_header("Host", host)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def run(out_path=None) -> int:
    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")  # console Windows non UTF-8
    collectors = build_collectors(demo_mode=False)
    report = {"windows": IS_WINDOWS, "sections": {}}
    failures = []
    data = {}
    for name in SECTIONS:
        start = time.time()
        try:
            data[name] = collectors[name]()
            report["sections"][name] = {"ok": True, "seconds": round(time.time() - start, 2),
                                        "summary": _summary(name, data[name])}
        except Exception as exc:
            data[name] = None
            report["sections"][name] = {"ok": False, "seconds": round(time.time() - start, 2), "error": repr(exc)}
            if IS_WINDOWS:
                failures.append(name)

    # compteurs PDH (charge GPU, fréquence réelle, disques) et capteurs
    try:
        from .collectors.counters import Counters
        from .collectors.sensors import SensorHub
        from .settings import MemorySettings
        pdh = Counters()
        time.sleep(1.2)
        sample = pdh.sample()
        pdh.close()
        report["counters"] = {"available": pdh.available,
                              "sample": {k: v for k, v in sample.items() if k not in ("gpus",)},
                              "gpus": sample.get("gpus")}
        hub = SensorHub(MemorySettings(), counters_source=lambda: sample)
        snap = hub.poll()
        report["sensors"] = {"sources": snap["sources"], "key": snap["key"], "nvidia": snap["nvidia"]}
        data["counters"] = sample
        data["sensors"] = snap["key"]
        if IS_WINDOWS and not sample:
            failures.append("counters")
    except Exception as exc:
        failures.append("counters")
        report["counters"] = {"error": repr(exc)}

    try:
        report["processes"] = performance.processes()["total"]
        data["live"] = performance.live_info()
        result = analysis.analyze(data)
        report["analysis"] = {"score": result["score"], "counts": result["counts"],
                              "titles": [f["severity"] + ": " + f["title"] for f in result["findings"]]}
    except Exception as exc:
        failures.append("analysis")
        report["analysis"] = {"error": repr(exc)}

    # serveur HTTP : page, API avec jeton, refus sans jeton et avec un Host étranger
    history = History(app_data_dir() / "selftest.db")
    sampler = Sampler(interval=0.5, on_sample=history.add)
    store = Store(build_collectors(demo_mode=not IS_WINDOWS), TTL)
    server = AppServer(Api(store, sampler, history), resource_dir() / "web")
    server.start()
    sampler.start()
    try:
        base = f"http://127.0.0.1:{server.port}"
        time.sleep(1.5)
        checks = {
            "index": _request(base + "/")[0] == 200,
            "app_js": _request(base + "/js/main.js")[0] == 200,
            "api_with_token": _request(base + "/api/status", server.token)[0] == 200,
            "api_without_token_refused": _request(base + "/api/status")[0] == 403,
            "foreign_host_refused": _request(base + "/api/status", server.token, host="evil.example:80")[0] == 421,
            "path_traversal_refused": _request(base + "/../pcinsight/api.py")[0] == 404,
        }
        status, body = _request(base + "/api/live", server.token)
        checks["live_points"] = status == 200 and len(json.loads(body)["points"]) > 0
    finally:
        sampler.stop()
        server.stop()
        history.close()
    report["server"] = checks
    failures += [k for k, ok in checks.items() if not ok]

    report["failures"] = failures
    text = json.dumps(report, ensure_ascii=False, indent=2, default=str)
    print(text)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
    return 1 if failures else 0
