"""Mesures de performance en temps réel (psutil) et liste des processus."""

import threading
import time
from collections import deque

import psutil


class Sampler(threading.Thread):
    """Échantillonne CPU, RAM, GPU, disques et réseau toutes les `interval` secondes.

    Les derniers points sont gardés en mémoire (graphiques temps réel) et transmis
    à `on_sample` (enregistrement de l'historique SQLite). Sous Windows, les compteurs
    PDH ajoutent la charge GPU, la fréquence réelle du CPU et l'activité des disques ;
    `sensor_value` (facultatif) fournit les températures lues par le SensorHub."""

    def __init__(self, interval=2.0, keep=300, on_sample=None, sensor_value=None, use_counters=True,
                 counters_factory=None):
        super().__init__(daemon=True, name="sampler")
        self.interval = interval
        self.points = deque(maxlen=keep)
        self.on_sample = on_sample
        self.sensor_value = sensor_value
        self.use_counters = use_counters
        self.counters_factory = counters_factory  # remplace les compteurs PDH (mode démo)
        self.counters = {}       # dernier relevé PDH complet (détails GPU, disques, mémoire)
        self.counters_ok = {}    # compteurs disponibles sur cette machine
        self._lock = threading.Lock()
        self._halt = threading.Event()

    def stop(self):
        self._halt.set()

    def last_counters(self) -> dict:
        with self._lock:
            return dict(self.counters)

    def run(self):
        pdh = None
        if self.use_counters:
            try:
                from .counters import Counters
                pdh = (self.counters_factory or Counters)()
                self.counters_ok = dict(pdh.available)
            except Exception:  # API PDH indisponible : on continue sans
                pdh = None
        psutil.cpu_percent(percpu=True)  # amorçage : la 1re mesure vaut toujours 0
        last_disk = psutil.disk_io_counters()
        last_net = psutil.net_io_counters()
        last_t = time.time()
        while not self._halt.wait(self.interval):
            try:
                now = time.time()
                dt = max(now - last_t, 1e-3)
                cores = psutil.cpu_percent(percpu=True)
                vm = psutil.virtual_memory()
                swap = psutil.swap_memory()
                disk = psutil.disk_io_counters()
                net = psutil.net_io_counters()
                extra = {}
                if pdh:
                    try:
                        extra = pdh.sample()
                    except Exception:
                        extra = {}
                point = {
                    "t": round(now, 3),
                    "cpu": round(sum(cores) / len(cores), 1) if cores else 0.0,
                    "cores": [round(c, 1) for c in cores],
                    "ram": round(vm.percent, 1),
                    "ram_used": vm.total - vm.available,
                    "swap": round(swap.percent, 1),
                    "disk_r": _rate(disk, last_disk, "read_bytes", dt),
                    "disk_w": _rate(disk, last_disk, "write_bytes", dt),
                    "net_up": _rate(net, last_net, "bytes_sent", dt),
                    "net_down": _rate(net, last_net, "bytes_recv", dt),
                    "gpu": extra.get("gpu"),
                    "gpu_mem": extra.get("gpu_mem"),
                    "cpu_mhz": extra.get("cpu_mhz"),
                    "disk_busy": extra.get("disk_busy"),
                    "cpu_temp": self.sensor_value("cpu_temp") if self.sensor_value else None,
                    "gpu_temp": self.sensor_value("gpu_temp") if self.sensor_value else None,
                }
                last_disk, last_net, last_t = disk, net, now
                with self._lock:
                    self.points.append(point)
                    if extra:
                        self.counters = extra
                if self.on_sample:
                    self.on_sample(point)
            except Exception:  # un échec ponctuel ne doit pas arrêter la collecte
                time.sleep(self.interval)
        if pdh:
            pdh.close()

    def since(self, t: float) -> list:
        with self._lock:
            return [p for p in self.points if p["t"] > t]


def _rate(cur, prev, field, dt):
    if cur is None or prev is None:
        return 0.0
    delta = getattr(cur, field) - getattr(prev, field)
    return max(delta, 0) / dt  # compteur remis à zéro -> 0


def live_info() -> dict:
    """Valeurs instantanées complémentaires (renvoyées avec chaque lot de points)."""
    vm = psutil.virtual_memory()
    swap = psutil.swap_memory()
    freq = None
    try:
        f = psutil.cpu_freq()
        freq = {"current": f.current, "max": f.max} if f else None
    except (OSError, NotImplementedError, AttributeError):
        pass
    battery = None
    try:
        b = psutil.sensors_battery()
        if b:
            battery = {
                "percent": b.percent,
                "plugged": b.power_plugged,
                "secsleft": b.secsleft if isinstance(b.secsleft, int) and b.secsleft > 0 else None,
            }
    except (OSError, NotImplementedError, AttributeError):
        pass
    return {
        "ram_total": vm.total,
        "ram_available": vm.available,
        "swap_total": swap.total,
        "swap_used": swap.used,
        "cpu_logical": psutil.cpu_count() or 1,
        "freq": freq,
        "battery": battery,
        "process_count": len(psutil.pids()),
        "uptime": time.time() - psutil.boot_time(),
    }


_proc_lock = threading.Lock()
_proc_primed = False


def processes(limit=60) -> dict:
    """Processus regroupés par nom (comme le Gestionnaire des tâches).

    psutil garde en cache les objets Process entre deux appels de process_iter,
    ce qui permet de calculer le % CPU depuis l'appel précédent."""
    global _proc_primed
    ncpu = psutil.cpu_count() or 1
    attrs = ["pid", "name", "username", "memory_info", "num_threads", "create_time", "exe"]
    with _proc_lock:
        if not _proc_primed:
            for p in psutil.process_iter():
                try:
                    p.cpu_percent(None)
                except (psutil.Error, OSError):
                    pass
            time.sleep(0.5)
            _proc_primed = True

        groups = {}
        total = 0
        for p in psutil.process_iter(attrs):
            total += 1
            try:
                cpu = p.cpu_percent(None) / ncpu
            except (psutil.Error, OSError):
                cpu = 0.0
            info = p.info
            name = info.get("name") or f"PID {info.get('pid')}"
            mem = info["memory_info"].rss if info.get("memory_info") else 0
            g = groups.setdefault(name.lower(), {
                "name": name, "count": 0, "cpu": 0.0, "memory": 0, "threads": 0,
                "pids": [], "user": None, "path": None,
            })
            g["count"] += 1
            g["cpu"] += cpu
            g["memory"] += mem
            g["threads"] += info.get("num_threads") or 0
            g["pids"].append(info.get("pid"))
            if info.get("username") and not g["user"]:
                g["user"] = info["username"]
            if info.get("exe") and not g["path"]:
                g["path"] = info["exe"]

    rows = list(groups.values())
    for g in rows:
        g["cpu"] = round(g["cpu"], 1)
        g["pids"] = g["pids"][:20]
    rows.sort(key=lambda g: (g["cpu"], g["memory"]), reverse=True)
    by_mem = sorted(rows, key=lambda g: g["memory"], reverse=True)
    return {
        "total": total,
        "groups": len(rows),
        "rows": rows[:limit],
        "top_memory": by_mem[:10],
    }
