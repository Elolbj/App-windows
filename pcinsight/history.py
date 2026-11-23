"""Historique des performances (SQLite) : une ligne agrégée par minute, conservée 30 jours."""

import math
import sqlite3
import threading
import time

RANGES = {  # durée en secondes, taille d'un regroupement pour les graphiques
    "1h": (3600, 60),
    "24h": (86400, 300),
    "7d": (7 * 86400, 1800),
    "30d": (30 * 86400, 7200),
}
RETENTION_DAYS = 30
EXTRA_COLUMNS = ("gpu_avg", "cpu_temp", "gpu_temp", "disk_busy")


class History:
    def __init__(self, path):
        self.path = str(path)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS perf (
                ts INTEGER PRIMARY KEY,           -- début de la minute (epoch)
                cpu_avg REAL, cpu_max REAL,
                ram_avg REAL, ram_max REAL, swap_avg REAL,
                disk_r REAL, disk_w REAL,         -- octets/s moyens
                net_up REAL, net_down REAL,
                samples INTEGER
            );
            CREATE TABLE IF NOT EXISTS disk (
                ts INTEGER, mount TEXT, used INTEGER, total INTEGER,
                PRIMARY KEY (ts, mount)
            );
        """)
        # colonnes ajoutées en v1.1 (migration des bases existantes)
        existing = {r[1] for r in self._db.execute("PRAGMA table_info(perf)")}
        for col in EXTRA_COLUMNS:
            if col not in existing:
                self._db.execute(f"ALTER TABLE perf ADD COLUMN {col} REAL")
        self._db.commit()
        self._bucket = None
        self._acc = []
        self.purge()

    # ------------------------------------------------------------------ écriture
    def add(self, point: dict):
        """Reçoit un échantillon du Sampler ; écrit la moyenne quand la minute change."""
        minute = int(point["t"] // 60 * 60)
        if self._bucket is not None and minute != self._bucket:
            self.flush()
        self._bucket = minute
        self._acc.append(point)

    def flush(self):
        if not self._acc or self._bucket is None:
            return
        acc, bucket = self._acc, self._bucket
        self._acc = []

        def avg(key):
            vals = [p[key] for p in acc if p.get(key) is not None]
            return sum(vals) / len(vals) if vals else None

        row = (bucket, avg("cpu"), max(p["cpu"] for p in acc), avg("ram"), max(p["ram"] for p in acc),
               avg("swap"), avg("disk_r"), avg("disk_w"), avg("net_up"), avg("net_down"), len(acc),
               avg("gpu"), avg("cpu_temp"), avg("gpu_temp"), avg("disk_busy"))
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO perf (ts, cpu_avg, cpu_max, ram_avg, ram_max, swap_avg, disk_r, disk_w, "
                "net_up, net_down, samples, gpu_avg, cpu_temp, gpu_temp, disk_busy) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row)
            self._db.commit()

    def add_disk_usage(self, partitions: list):
        ts = int(time.time() // 3600 * 3600)  # une mesure par heure
        rows = [(ts, p["mount"], p["used"], p["total"]) for p in partitions if not p.get("removable")]
        with self._lock:
            self._db.executemany("INSERT OR REPLACE INTO disk VALUES (?,?,?,?)", rows)
            self._db.commit()

    def purge(self):
        limit = int(time.time()) - RETENTION_DAYS * 86400
        with self._lock:
            self._db.execute("DELETE FROM perf WHERE ts < ?", (limit,))
            self._db.execute("DELETE FROM disk WHERE ts < ?", (limit,))
            self._db.commit()

    def close(self):
        self.flush()
        with self._lock:
            self._db.close()

    # ------------------------------------------------------------------ lecture
    def query(self, range_key="24h", now=None) -> dict:
        span, bucket = RANGES.get(range_key, RANGES["24h"])
        now = now or time.time()
        start = int(now - span)
        with self._lock:
            rows = self._db.execute(
                "SELECT ts, cpu_avg, cpu_max, ram_avg, ram_max, swap_avg, disk_r, disk_w, net_up, net_down, "
                "gpu_avg, cpu_temp, gpu_temp FROM perf WHERE ts >= ? ORDER BY ts", (start,)).fetchall()
            series = self._db.execute(
                f"SELECT (ts / {bucket}) * {bucket} AS b, AVG(cpu_avg), MAX(cpu_max), AVG(ram_avg), "
                "AVG(disk_r + disk_w), AVG(net_up + net_down), AVG(gpu_avg), AVG(cpu_temp), AVG(gpu_temp), "
                "MAX(cpu_temp) FROM perf WHERE ts >= ? GROUP BY b ORDER BY b",
                (start,)).fetchall()
            disk = self._db.execute(
                "SELECT ts, mount, used, total FROM disk WHERE ts >= ? ORDER BY ts", (start,)).fetchall()
        return {
            "range": range_key,
            "bucket": bucket,
            "series": [{"t": r[0], "cpu": r[1], "cpu_max": r[2], "ram": r[3], "disk": r[4], "net": r[5],
                        "gpu": r[6], "cpu_temp": r[7], "gpu_temp": r[8], "cpu_temp_max": r[9]} for r in series],
            "stats": compute_stats(rows, span),
            "hourly": hourly_profile(rows),
            "disk": _disk_series(disk),
        }


def percentile(values, p):
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def compute_stats(rows, span) -> dict:
    if not rows:
        return {"minutes": 0, "coverage": 0}
    cpu = [r[1] for r in rows]
    ram = [r[3] for r in rows]
    gpu = [r[10] for r in rows if r[10] is not None]
    ctemp = [r[11] for r in rows if r[11] is not None]
    gtemp = [r[12] for r in rows if r[12] is not None]
    return {
        "gpu_avg": sum(gpu) / len(gpu) if gpu else None,
        "gpu_p95": percentile(gpu, 95),
        "cpu_temp_avg": sum(ctemp) / len(ctemp) if ctemp else None,
        "cpu_temp_max": max(ctemp) if ctemp else None,
        "gpu_temp_avg": sum(gtemp) / len(gtemp) if gtemp else None,
        "gpu_temp_max": max(gtemp) if gtemp else None,
        "minutes": len(rows),
        "coverage": round(100 * len(rows) * 60 / span, 1),
        "first": rows[0][0],
        "cpu_avg": sum(cpu) / len(cpu),
        "cpu_max": max(r[2] for r in rows),
        "cpu_p95": percentile(cpu, 95),
        "cpu_high_minutes": sum(1 for c in cpu if c >= 80),
        "ram_avg": sum(ram) / len(ram),
        "ram_max": max(r[4] for r in rows),
        "ram_p95": percentile(ram, 95),
        "ram_high_minutes": sum(1 for r in ram if r >= 85),
        "disk_read": sum(r[6] for r in rows) * 60,   # octets lus sur la période enregistrée
        "disk_write": sum(r[7] for r in rows) * 60,
        "net_up": sum(r[8] for r in rows) * 60,
        "net_down": sum(r[9] for r in rows) * 60,
    }


def hourly_profile(rows) -> list:
    """CPU et RAM moyens par heure de la journée (heure locale)."""
    sums = [[0.0, 0.0, 0] for _ in range(24)]
    for r in rows:
        h = time.localtime(r[0]).tm_hour
        sums[h][0] += r[1]
        sums[h][1] += r[3]
        sums[h][2] += 1
    return [{"hour": h, "cpu": s[0] / s[2] if s[2] else None, "ram": s[1] / s[2] if s[2] else None,
             "minutes": s[2]} for h, s in enumerate(sums)]


def _disk_series(rows) -> dict:
    out = {}
    for ts, mount, used, total in rows:
        out.setdefault(mount, []).append({"t": ts, "used": used, "total": total})
    return out
