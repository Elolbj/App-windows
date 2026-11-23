"""Capteurs matériels : températures, ventilateurs, puissance, fréquences.

Trois sources, de la plus simple à la plus complète :
1. Compteurs Windows (PDH) : charge GPU, zones thermiques ACPI — toujours disponibles.
2. nvidia-smi : fourni avec le pilote NVIDIA (température, puissance, ventilateur du GPU).
3. LibreHardwareMonitor (optionnel, logiciel tiers libre) : tous les capteurs de la carte
   mère, du CPU, des disques... Il doit tourner avec son « serveur web distant » activé ;
   PC Insight lit alors http://127.0.0.1:<port>/data.json. PC Insight n'installe aucun pilote
   lui-même : c'est LibreHardwareMonitor qui utilise le pilote PawnIO.
"""

import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from collections import deque

from ..winutil import IS_WINDOWS, NO_WINDOW

log = logging.getLogger(__name__)

UNITS = {
    "Temperature": "°C", "Load": "%", "Fan": "tr/min", "Power": "W", "Clock": "MHz", "Voltage": "V",
    "Current": "A", "Data": "Go", "SmallData": "Mo", "Throughput": "o/s", "Control": "%", "Level": "%",
    "Factor": "", "Frequency": "Hz", "Energy": "mWh", "Flow": "L/h", "Noise": "dBA", "Humidity": "%",
    "Conductivity": "µS/cm", "TimeSpan": "s", "Timing": "ns",
}
TYPE_LABELS = {
    "Temperature": "Températures", "Load": "Charge", "Fan": "Ventilateurs", "Power": "Puissance",
    "Clock": "Fréquences", "Voltage": "Tensions", "Current": "Intensités", "Data": "Données",
    "SmallData": "Mémoire", "Throughput": "Débit", "Control": "Pilotage ventilateurs", "Level": "Niveau",
    "Factor": "Facteur", "Frequency": "Fréquence", "Energy": "Énergie", "Flow": "Débit liquide",
    "Noise": "Bruit", "Humidity": "Humidité", "TimeSpan": "Durée", "Timing": "Timings",
}
KIND_FROM_IMAGE = [("cpu", "cpu"), ("nvidia", "gpu"), ("ati", "gpu"), ("amd", "gpu"), ("intel", "gpu"),
                   ("gpu", "gpu"), ("mainboard", "board"), ("chip", "board"), ("ram", "memory"),
                   ("hdd", "storage"), ("nic", "network"), ("battery", "battery"), ("psu", "psu"),
                   ("cooler", "cooler"), ("fan", "cooler")]
NUM_RE = re.compile(r"-?\d+(?:[.,]\d+)?")
LHM_URL = "http://127.0.0.1:{port}/data.json"

# Pas de proxy pour 127.0.0.1 (un proxy système mal configuré casserait la connexion locale)
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _num(value):
    if isinstance(value, (int, float)):
        return float(value) if value == value else None  # NaN -> None
    if not value:
        return None
    m = NUM_RE.search(str(value))
    return float(m.group(0).replace(",", ".")) if m else None


def _kind(hardware_id: str, image: str) -> str:
    text = f"{hardware_id or ''} {image or ''}".lower()
    if "/gpu" in text:
        return "gpu"
    for needle, kind in KIND_FROM_IMAGE:
        if needle in text:
            return kind
    return "other"


def parse_lhm(data: dict) -> dict:
    """Aplatit l'arbre data.json de LibreHardwareMonitor en matériels + capteurs."""
    hardware, sensors = [], []

    def walk(node, hw):
        if "SensorId" in node:
            stype = node.get("Type") or ""
            value = _num(node.get("RawValue")) if "RawValue" in node else _num(node.get("Value"))
            sensors.append({
                "id": node.get("SensorId"), "name": node.get("Text"), "type": stype,
                "value": value,
                "min": _num(node.get("RawMin")) if "RawMin" in node else _num(node.get("Min")),
                "max": _num(node.get("RawMax")) if "RawMax" in node else _num(node.get("Max")),
                "unit": UNITS.get(stype, ""), "hardware": hw["name"] if hw else "?",
                "kind": hw["kind"] if hw else "other",
            })
            return
        if "HardwareId" in node:
            hw = {"name": node.get("Text"), "id": node.get("HardwareId"),
                  "kind": _kind(node.get("HardwareId"), node.get("ImageURL"))}
            hardware.append(hw)
        for child in node.get("Children") or []:
            walk(child, hw)

    walk(data, None)
    return {"version": data.get("Version"), "hardware": hardware, "sensors": sensors}


def read_lhm(port: int, timeout=0.8) -> dict:
    with _opener.open(LHM_URL.format(port=int(port)), timeout=timeout) as r:
        return parse_lhm(json.loads(r.read().decode("utf-8-sig")))


# --------------------------------------------------------------------------- NVIDIA
NVSMI_FIELDS = ["name", "temperature.gpu", "utilization.gpu", "utilization.memory", "memory.used",
                "memory.total", "power.draw", "power.limit", "fan.speed", "clocks.gr", "clocks.mem",
                "pstate", "driver_version"]
_nvsmi_path = None


def _find_nvsmi():
    global _nvsmi_path
    if _nvsmi_path is None:
        candidates = [shutil.which("nvidia-smi")]
        if IS_WINDOWS:
            candidates += [os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "nvidia-smi.exe"),
                           r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"]
        _nvsmi_path = next((c for c in candidates if c and os.path.isfile(c)), "")
    return _nvsmi_path


def read_nvidia() -> list:
    exe = _find_nvsmi()
    if not exe:
        return []
    proc = subprocess.run([exe, f"--query-gpu={','.join(NVSMI_FIELDS)}", "--format=csv,noheader,nounits"],
                          capture_output=True, stdin=subprocess.DEVNULL, timeout=5, creationflags=NO_WINDOW)
    gpus = []
    for line in proc.stdout.decode("utf-8", errors="replace").splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != len(NVSMI_FIELDS):
            continue
        row = dict(zip(NVSMI_FIELDS, parts))
        num = lambda k: _num(row[k]) if row[k] and "N/A" not in row[k] and "Not" not in row[k] else None  # noqa: E731
        gpus.append({
            "name": row["name"], "temp": num("temperature.gpu"), "load": num("utilization.gpu"),
            "mem_load": num("utilization.memory"),
            "mem_used": num("memory.used") * 1024 ** 2 if num("memory.used") is not None else None,
            "mem_total": num("memory.total") * 1024 ** 2 if num("memory.total") is not None else None,
            "power": num("power.draw"), "power_limit": num("power.limit"), "fan": num("fan.speed"),
            "clock": num("clocks.gr"), "mem_clock": num("clocks.mem"), "pstate": row["pstate"],
            "driver": row["driver_version"],
        })
    return gpus


# --------------------------------------------------------------------------- synthèse
def _pick(sensors, kind, stype, prefer=(), aggregate=max):
    cands = [s for s in sensors if s["kind"] == kind and s["type"] == stype and s["value"] is not None]
    for word in prefer:
        for s in cands:
            if word in (s["name"] or "").lower():
                return s["value"]
    vals = [s["value"] for s in cands]
    return aggregate(vals) if vals else None


def key_values(lhm: dict, nvidia: list, counters: dict) -> dict:
    """Les quelques valeurs affichées en tuiles, avec leur source."""
    s = (lhm or {}).get("sensors") or []
    out = {}

    def put(key, value, source):
        if value is not None and key not in out:
            out[key] = {"value": round(value, 1), "source": source}

    put("cpu_temp", _pick(s, "cpu", "Temperature", ("package", "tctl", "tdie", "core (tctl")), "LibreHardwareMonitor")
    put("cpu_power", _pick(s, "cpu", "Power", ("package",)), "LibreHardwareMonitor")
    put("cpu_clock", _pick(s, "cpu", "Clock", (), aggregate=max), "LibreHardwareMonitor")
    if nvidia:
        put("gpu_temp", nvidia[0]["temp"], "nvidia-smi")
        put("gpu_power", nvidia[0]["power"], "nvidia-smi")
        put("gpu_fan", nvidia[0]["fan"], "nvidia-smi")
    put("gpu_temp", _pick(s, "gpu", "Temperature", ("core", "gpu")), "LibreHardwareMonitor")
    put("gpu_power", _pick(s, "gpu", "Power", ("package", "total", "core")), "LibreHardwareMonitor")
    put("gpu_load", (counters or {}).get("gpu"), "Compteurs Windows")
    if nvidia:
        put("gpu_load", nvidia[0]["load"], "nvidia-smi")
    put("disk_temp", _pick(s, "storage", "Temperature"), "LibreHardwareMonitor")
    fans = [x["value"] for x in s if x["type"] == "Fan" and x["value"]]
    if fans:
        put("fan_max", max(fans), "LibreHardwareMonitor")
    zones = (counters or {}).get("thermal") or []
    if zones:
        put("cpu_temp", max(z["temp"] for z in zones), "Zone thermique ACPI (approximatif)")
    return out


class SensorHub(threading.Thread):
    """Interroge les sources toutes les `interval` secondes et garde un court historique."""

    def __init__(self, settings, counters_source=None, interval=3.0, keep=200, demo=False):
        super().__init__(daemon=True, name="sensors")
        self.settings = settings
        self.counters_source = counters_source  # fonction renvoyant le dernier relevé PDH
        self.interval = interval
        self.demo = demo
        self.history = deque(maxlen=keep)
        self.latest = {"key": {}, "lhm": None, "nvidia": [], "sources": {}, "time": 0}
        self._lock = threading.Lock()
        self._halt = threading.Event()

    def stop(self):
        self._halt.set()

    def poll(self) -> dict:
        sources = {}
        counters = self.counters_source() if self.counters_source else {}
        sources["counters"] = {"ok": bool(counters), "label": "Compteurs de performance Windows"}

        lhm = None
        if self.demo:
            from ..demo import sensors_lhm
            lhm = sensors_lhm()
            sources["lhm"] = {"ok": True, "version": lhm.get("version"), "port": 8085}
        elif self.settings.get("lhm_enabled"):
            port = self.settings.get("lhm_port")
            try:
                lhm = read_lhm(port)
                sources["lhm"] = {"ok": True, "version": lhm.get("version"), "port": port}
            except Exception as exc:  # LHM non lancé ou serveur web désactivé
                sources["lhm"] = {"ok": False, "port": port, "error": str(getattr(exc, "reason", exc))}
        else:
            sources["lhm"] = {"ok": False, "disabled": True}

        nvidia = []
        if self.demo:
            from ..demo import sensors_nvidia
            nvidia = sensors_nvidia()
        else:
            try:
                nvidia = read_nvidia()
            except Exception as exc:
                log.debug("nvidia-smi : %s", exc)
        sources["nvidia"] = {"ok": bool(nvidia), "found": bool(nvidia) or bool(_find_nvsmi()) or self.demo}

        snap = {"time": time.time(), "key": key_values(lhm, nvidia, counters), "lhm": lhm,
                "nvidia": nvidia, "sources": sources, "thermal": (counters or {}).get("thermal") or []}
        with self._lock:
            self.latest = snap
            self.history.append({"t": snap["time"], **{k: v["value"] for k, v in snap["key"].items()}})
        return snap

    def run(self):
        while not self._halt.is_set():
            try:
                self.poll()
            except Exception:
                log.exception("Lecture des capteurs impossible")
            self._halt.wait(self.interval)

    def snapshot(self, since=0.0) -> dict:
        with self._lock:
            snap = dict(self.latest)
            snap["history"] = [h for h in self.history if h["t"] > since]
        return snap

    def value(self, key):
        with self._lock:
            v = self.latest["key"].get(key)
        return v["value"] if v else None
