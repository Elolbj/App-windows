"""Compteurs de performance Windows (API PDH, lue via ctypes, sans pilote ni droits admin).

Fournit ce que psutil ne sait pas mesurer sous Windows :
- charge GPU (tous fabricants : NVIDIA, AMD, Intel) et mémoire vidéo utilisée ;
- fréquence réelle du processeur (turbo compris), comme le Gestionnaire des tâches ;
- taux d'activité et temps de réponse de chaque disque ;
- détails mémoire (mémoire engagée, cache, pagination) ;
- température des zones thermiques ACPI (approximative, pas toujours disponible).

Les noms de compteurs « anglais » (PdhAddEnglishCounterW) fonctionnent quelle que soit la
langue de Windows.
"""

import ctypes
import re

from ..winutil import IS_WINDOWS

PDH_FMT_DOUBLE = 0x00000200
PDH_FMT_NOCAP100 = 0x00008000
PDH_MORE_DATA = 0x800007D2

COUNTERS = {
    "cpu_perf": r"\Processor Information(_Total)\% Processor Performance",
    "cpu_base": r"\Processor Information(_Total)\Processor Frequency",
    "gpu_engine": r"\GPU Engine(*)\Utilization Percentage",
    "gpu_dedicated": r"\GPU Adapter Memory(*)\Dedicated Usage",
    "gpu_shared": r"\GPU Adapter Memory(*)\Shared Usage",
    "disk_idle": r"\PhysicalDisk(*)\% Idle Time",
    "disk_latency": r"\PhysicalDisk(*)\Avg. Disk sec/Transfer",
    "disk_queue": r"\PhysicalDisk(*)\Current Disk Queue Length",
    "thermal": r"\Thermal Zone Information(*)\Temperature",
    "committed": r"\Memory\Committed Bytes",
    "commit_limit": r"\Memory\Commit Limit",
    "cache": r"\Memory\Cache Bytes",
    "pool_paged": r"\Memory\Pool Paged Bytes",
    "pool_nonpaged": r"\Memory\Pool Nonpaged Bytes",
    "pages_input": r"\Memory\Pages Input/sec",
    "queue": r"\System\Processor Queue Length",
    "handles": r"\Process(_Total)\Handle Count",
    "threads": r"\System\Threads",
}

ENGINE_RE = re.compile(r"luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys_\d+_eng_\d+_engtype_(.*)$", re.I)
ADAPTER_RE = re.compile(r"luid_(0x[0-9a-f]+_0x[0-9a-f]+)", re.I)
ENGINE_LABELS = {"3d": "3D", "videodecode": "Décodage vidéo", "videoencode": "Encodage vidéo",
                 "copy": "Copie", "compute": "Calcul", "videoprocessing": "Traitement vidéo",
                 "graphics_1": "Graphique", "security": "Sécurité"}


if IS_WINDOWS:
    from ctypes import wintypes

    class _FmtValue(ctypes.Structure):
        # PDH_FMT_COUNTERVALUE : DWORD CStatus + union (8 octets, aligné sur 8)
        _fields_ = [("CStatus", wintypes.DWORD), ("doubleValue", ctypes.c_double)]

    class _FmtItem(ctypes.Structure):
        # PDH_FMT_COUNTERVALUE_ITEM_W
        _fields_ = [("szName", wintypes.LPWSTR), ("FmtValue", _FmtValue)]

    _pdh = ctypes.WinDLL("pdh")
    _HANDLE_P = ctypes.POINTER(ctypes.c_void_p)
    _DWORD_P = ctypes.POINTER(wintypes.DWORD)
    _pdh.PdhOpenQueryW.argtypes = [wintypes.LPCWSTR, ctypes.c_size_t, _HANDLE_P]
    _pdh.PdhAddEnglishCounterW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, ctypes.c_size_t, _HANDLE_P]
    _pdh.PdhCollectQueryData.argtypes = [ctypes.c_void_p]
    _pdh.PdhGetFormattedCounterValue.argtypes = [ctypes.c_void_p, wintypes.DWORD, _DWORD_P, ctypes.POINTER(_FmtValue)]
    _pdh.PdhGetFormattedCounterArrayW.argtypes = [ctypes.c_void_p, wintypes.DWORD, _DWORD_P, _DWORD_P, ctypes.c_void_p]
    _pdh.PdhCloseQuery.argtypes = [ctypes.c_void_p]
    for _f in ("PdhOpenQueryW", "PdhAddEnglishCounterW", "PdhCollectQueryData",
               "PdhGetFormattedCounterValue", "PdhGetFormattedCounterArrayW", "PdhCloseQuery"):
        getattr(_pdh, _f).restype = ctypes.c_long


class Counters:
    """Requête PDH persistante. À utiliser depuis un seul thread (celui du Sampler)."""

    def __init__(self):
        self.available = {}
        self._query = None
        self._handles = {}
        if not IS_WINDOWS:
            return
        q = ctypes.c_void_p()
        if _pdh.PdhOpenQueryW(None, 0, ctypes.byref(q)) != 0:
            return
        self._query = q
        for key, path in COUNTERS.items():
            h = ctypes.c_void_p()
            ok = _pdh.PdhAddEnglishCounterW(q, path, 0, ctypes.byref(h)) == 0
            self.available[key] = ok
            if ok:
                self._handles[key] = h
        _pdh.PdhCollectQueryData(q)  # 1re collecte : les compteurs de taux ont besoin de deux mesures

    def close(self):
        if self._query:
            _pdh.PdhCloseQuery(self._query)
            self._query = None

    # ------------------------------------------------------------------ lecture brute
    def _value(self, key):
        h = self._handles.get(key)
        if h is None:
            return None
        v = _FmtValue()
        if _pdh.PdhGetFormattedCounterValue(h, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, None, ctypes.byref(v)) != 0:
            return None
        return v.doubleValue if v.CStatus in (0, 1) else None

    def _array(self, key) -> dict:
        h = self._handles.get(key)
        if h is None:
            return {}
        size, count = wintypes.DWORD(0), wintypes.DWORD(0)
        fmt = PDH_FMT_DOUBLE | PDH_FMT_NOCAP100
        rc = _pdh.PdhGetFormattedCounterArrayW(h, fmt, ctypes.byref(size), ctypes.byref(count), None)
        if (rc & 0xFFFFFFFF) != PDH_MORE_DATA or not size.value:
            return {}
        buf = (ctypes.c_byte * size.value)()
        if _pdh.PdhGetFormattedCounterArrayW(h, fmt, ctypes.byref(size), ctypes.byref(count), buf) != 0:
            return {}
        items = ctypes.cast(buf, ctypes.POINTER(_FmtItem))
        out = {}
        for i in range(count.value):
            it = items[i]
            if it.FmtValue.CStatus in (0, 1):  # PDH_CSTATUS_VALID_DATA / NEW_DATA
                out[it.szName] = out.get(it.szName, 0.0) + it.FmtValue.doubleValue
        return out

    # ------------------------------------------------------------------ mesure
    def sample(self) -> dict:
        if not self._query or _pdh.PdhCollectQueryData(self._query) != 0:
            return {}
        out = {}

        perf, base = self._value("cpu_perf"), self._value("cpu_base")
        if perf and base:
            out["cpu_mhz"] = round(base * perf / 100)

        out.update(gpu_summary(self._array("gpu_engine"), self._array("gpu_dedicated"), self._array("gpu_shared")))

        idle = self._array("disk_idle")
        latency = self._array("disk_latency")
        queue = self._array("disk_queue")
        disks = []
        for name, value in idle.items():
            if name == "_Total":
                continue
            disks.append({"name": name, "busy": round(max(0.0, min(100.0, 100 - value)), 1),
                          "latency_ms": round(latency.get(name, 0.0) * 1000, 2), "queue": queue.get(name, 0.0)})
        disks.sort(key=lambda d: d["name"])
        if disks:
            out["disks"] = disks
            out["disk_busy"] = max(d["busy"] for d in disks)

        zones = []
        for name, kelvin in self._array("thermal").items():
            c = kelvin - 273.15
            if 5 < c < 120:  # ignore les valeurs fantaisistes de certaines machines virtuelles
                zones.append({"name": name, "temp": round(c, 1)})
        if zones:
            out["thermal"] = zones

        mem = {k: self._value(k) for k in ("committed", "commit_limit", "cache", "pool_paged", "pool_nonpaged", "pages_input")}
        out["memory"] = {k: v for k, v in mem.items() if v is not None}
        for k in ("queue", "handles", "threads"):
            v = self._value(k)
            if v is not None:
                out[k] = v
        return out


def gpu_summary(engines: dict, dedicated: dict, shared: dict) -> dict:
    """Charge par carte graphique = moteur le plus occupé (méthode du Gestionnaire des tâches)."""
    adapters = {}
    for name, value in engines.items():
        m = ENGINE_RE.search(name)
        if not m:
            continue
        luid, engtype = m.group(1).lower(), m.group(2)
        a = adapters.setdefault(luid, {"engines": {}})
        a["engines"][engtype] = a["engines"].get(engtype, 0.0) + value
    for source, key in ((dedicated, "dedicated"), (shared, "shared")):
        for name, value in source.items():
            m = ADAPTER_RE.search(name)
            if m:
                a = adapters.setdefault(m.group(1).lower(), {"engines": {}})
                a[key] = a.get(key, 0.0) + value
    if not adapters:
        return {}
    gpus = []
    for luid, a in adapters.items():
        engines_pct = {k: round(min(v, 100.0), 1) for k, v in a["engines"].items()}
        gpus.append({
            "luid": luid,
            "load": max(engines_pct.values()) if engines_pct else 0.0,
            "engines": {ENGINE_LABELS.get(k.lower(), k): v for k, v in sorted(engines_pct.items(), key=lambda x: -x[1])[:6]},
            "dedicated": int(a.get("dedicated", 0)),
            "shared": int(a.get("shared", 0)),
        })
    # la carte qui utilise le plus de mémoire dédiée est généralement la carte principale
    gpus.sort(key=lambda g: (g["dedicated"], g["load"]), reverse=True)
    gpus = [g for g in gpus if g["engines"] or g["dedicated"]]
    if not gpus:
        return {}
    return {"gpus": gpus, "gpu": max(g["load"] for g in gpus), "gpu_mem": gpus[0]["dedicated"]}
