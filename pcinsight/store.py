"""Cache des sections collectées : chaque section est calculée au plus une fois à la fois,
puis réutilisée pendant sa durée de validité (TTL)."""

import logging
import threading
import time

log = logging.getLogger(__name__)


class _Entry:
    def __init__(self):
        self.lock = threading.Lock()
        self.value = None
        self.error = None
        self.updated = 0.0
        self.duration = 0.0
        self.loading = False


class Store:
    def __init__(self, collectors: dict, ttl: dict):
        self.collectors = collectors      # nom -> fonction sans argument
        self.ttl = ttl                    # nom -> secondes
        self._entries = {name: _Entry() for name in collectors}

    def get(self, name: str, refresh=False) -> dict:
        entry = self._entries[name]
        asked = time.time()
        with entry.lock:  # une seule collecte à la fois par section
            fresh = entry.updated and time.time() - entry.updated < self.ttl.get(name, 60)
            done_meanwhile = entry.updated >= asked  # un autre thread vient de la calculer
            if (refresh and not done_meanwhile) or not fresh:
                entry.loading = True
                start = time.time()
                try:
                    entry.value = self.collectors[name]()
                    entry.error = None
                except Exception as exc:
                    log.exception("Collecte %s impossible", name)
                    entry.error = str(exc) or exc.__class__.__name__
                finally:
                    entry.duration = time.time() - start
                    entry.updated = time.time()
                    entry.loading = False
            return {"data": entry.value, "error": entry.error, "updated": entry.updated,
                    "duration": round(entry.duration, 2)}

    def value(self, name: str):
        """Donnée en cache (ou None) sans déclencher de collecte."""
        entry = self._entries.get(name)
        return entry.value if entry else None

    def prefetch(self, names=None):
        for name in names or self.collectors:
            threading.Thread(target=self.get, args=(name,), daemon=True, name=f"prefetch-{name}").start()

    def status(self) -> dict:
        out = {}
        for name, e in self._entries.items():
            out[name] = {"ready": e.updated > 0 and not e.loading, "loading": e.loading,
                         "error": e.error, "updated": e.updated, "duration": round(e.duration, 2)}
        return out
