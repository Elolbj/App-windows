"""Réglages de l'application, enregistrés dans %LOCALAPPDATA%\\PCInsight\\settings.json."""

import json
import threading

DEFAULTS = {
    "lhm_enabled": True,   # lire LibreHardwareMonitor s'il tourne
    "lhm_port": 8085,      # port de son serveur web
}


def _validate(key, value):
    if key == "lhm_enabled":
        return bool(value)
    if key == "lhm_port":
        port = int(value)
        if not 1024 <= port <= 65535:
            raise ValueError("Le port doit être compris entre 1024 et 65535")
        return port
    raise KeyError(key)


class Settings:
    def __init__(self, path):
        self.path = path
        self._lock = threading.Lock()
        self._data = dict(DEFAULTS)
        try:
            with open(path, encoding="utf-8") as f:
                saved = json.load(f)
            for k, v in saved.items():
                if k in DEFAULTS:
                    self._data[k] = _validate(k, v)
        except (OSError, ValueError, KeyError, TypeError):
            pass  # fichier absent ou invalide : valeurs par défaut

    def get(self, key):
        with self._lock:
            return self._data.get(key, DEFAULTS.get(key))

    def all(self) -> dict:
        with self._lock:
            return dict(self._data)

    def update(self, changes: dict) -> dict:
        clean = {k: _validate(k, v) for k, v in (changes or {}).items() if k in DEFAULTS}
        with self._lock:
            self._data.update(clean)
            data = dict(self._data)
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=1)
        except OSError:
            pass
        return data


class MemorySettings(Settings):
    """Réglages non persistants (tests, auto-test)."""

    def __init__(self):  # noqa: D401 - pas de fichier
        self.path = None
        self._lock = threading.Lock()
        self._data = dict(DEFAULTS)

    def update(self, changes: dict) -> dict:
        clean = {k: _validate(k, v) for k, v in (changes or {}).items() if k in DEFAULTS}
        with self._lock:
            self._data.update(clean)
            return dict(self._data)
