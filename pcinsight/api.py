"""Routes de l'API JSON utilisée par l'interface."""

import logging
import threading
import time

from . import APP_NAME, __version__, analysis, demo, report
from .collectors import events, hardware, network, performance, security, software, storage, system, updates
from .server import ApiError
from .winutil import IS_WINDOWS, documents_dir, is_admin, open_path, relaunch_as_admin

log = logging.getLogger(__name__)

SECTIONS = ("system", "hardware", "storage", "software", "network", "netconfig", "security", "events", "updates")
TTL = {"system": 60, "hardware": 3600, "storage": 60, "software": 600, "network": 15, "netconfig": 300,
       "security": 300, "events": 600, "updates": 1800}


def build_collectors(demo_mode: bool) -> dict:
    """Vraies collectes sous Windows ; données de démo pour les sections Windows sinon."""
    real = IS_WINDOWS and not demo_mode
    return {
        "system": system.collect if IS_WINDOWS else (lambda: demo.patch_system(system.collect())),
        "storage": storage.collect,
        "network": network.collect,
        "hardware": hardware.collect if real else demo.hardware,
        "software": software.collect if real else demo.software,
        "security": security.collect if real else demo.security,
        "events": events.collect if real else demo.events,
        "updates": updates.collect if real else demo.updates,
        "netconfig": network.config if real else demo.netconfig,
    }


class Api:
    def __init__(self, store, sampler, history, demo_mode=False, on_quit=None):
        self.store = store
        self.sampler = sampler
        self.history = history
        self.demo = demo_mode or not IS_WINDOWS
        self.on_quit = on_quit
        self.pending = None           # résultat de la dernière recherche de mises à jour
        self.pending_running = False
        self._pending_lock = threading.Lock()
        self.last_report = None

    # ------------------------------------------------------------------ routage
    def handle(self, method, path, query, body):
        refresh = query.get("refresh") == "1"
        if method == "GET":
            if path in SECTIONS:
                return self.store.get(path, refresh=refresh)
            routes = {
                "status": self.status,
                "live": lambda: self.live(float(query.get("since") or 0)),
                "processes": performance.processes,
                "history": lambda: self.history.query(query.get("range", "24h")),
                "analysis": lambda: self.analysis(refresh),
                "updates/pending": self.pending_status,
            }
        elif method == "POST":
            routes = {
                "updates/pending": self.search_updates,
                "export": self.export,
                "open-report": self.open_report,
                "open-folder": self.open_folder,
                "elevate": self.elevate,
            }
        else:
            routes = {}
        if path not in routes:
            raise ApiError(404, f"Route inconnue : {path}")
        return routes[path]()

    # ------------------------------------------------------------------ handlers
    def status(self):
        return {
            "app": APP_NAME, "version": __version__, "demo": self.demo, "windows": IS_WINDOWS,
            "admin": is_admin(), "sections": self.store.status(),
        }

    def live(self, since):
        return {"points": self.sampler.since(since), "info": performance.live_info()}

    def collect_all(self, refresh=False) -> dict:
        """Récupère toutes les sections en parallèle (chaque section a son propre verrou)."""
        results = {}

        def worker(name):
            results[name] = self.store.get(name, refresh=refresh)

        threads = [threading.Thread(target=worker, args=(n,), daemon=True) for n in SECTIONS]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=300)
        data = {name: (results.get(name) or {}).get("data") for name in SECTIONS}
        errors = {name: r.get("error") for name, r in results.items() if r.get("error")}
        return data, errors

    def analysis(self, refresh=False):
        data, errors = self.collect_all(refresh)
        data["live"] = performance.live_info()
        data["history"] = self.history.query("24h")
        if data.get("updates") is not None and self.pending:
            data["updates"] = {**data["updates"], "pending": self.pending.get("updates")}
        result = analysis.analyze(data)
        result["unavailable"] = errors
        return result

    def pending_status(self):
        return {"running": self.pending_running, "result": self.pending}

    def search_updates(self):
        with self._pending_lock:
            if self.pending_running:
                raise ApiError(409, "Recherche déjà en cours")
            self.pending_running = True
        try:
            self.pending = updates.pending() if (IS_WINDOWS and not self.demo) else demo.updates_pending()
            if self.demo:
                time.sleep(1.5)  # simule la durée de la recherche
            return self.pending
        finally:
            self.pending_running = False

    def export(self):
        data, _ = self.collect_all()
        data["analysis"] = self.analysis()
        data["history_24h"] = self.history.query("24h")
        folder = documents_dir() / "PC Insight"
        self.last_report = report.export(data, folder)
        return self.last_report

    def open_report(self):
        # n'ouvre que le fichier produit par l'application (pas de chemin fourni par le client)
        if not self.last_report:
            raise ApiError(404, "Aucun rapport généré")
        open_path(self.last_report["html"])
        return {"ok": True}

    def open_folder(self):
        if not self.last_report:
            raise ApiError(404, "Aucun rapport généré")
        open_path(self.last_report["folder"])
        return {"ok": True}

    def elevate(self):
        if is_admin():
            return {"ok": False, "message": "L'application a déjà les droits administrateur."}
        if not relaunch_as_admin():
            return {"ok": False, "message": "Élévation refusée ou impossible."}
        if self.on_quit:
            threading.Timer(1.0, self.on_quit).start()
        return {"ok": True}


def storage_snapshot_loop(history, stop_event, interval=3600):
    """Enregistre l'occupation des disques une fois par heure."""
    while True:
        try:
            history.add_disk_usage(storage.partitions())
        except Exception:
            log.exception("Mesure de l'espace disque impossible")
        if stop_event.wait(interval):
            return
