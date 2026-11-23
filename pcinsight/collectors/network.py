"""Interfaces réseau, ports en écoute, connexions et configuration (DNS, passerelle, Wi-Fi)."""

import re
import socket
import subprocess
import unicodedata
from collections import Counter

import psutil

from ..ps import as_list, run_script
from ..winutil import IS_WINDOWS, NO_WINDOW

KNOWN_PORTS = {
    21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS", 80: "HTTP", 110: "POP3",
    123: "NTP", 135: "RPC (Windows)", 137: "NetBIOS", 138: "NetBIOS", 139: "NetBIOS/SMB",
    143: "IMAP", 443: "HTTPS", 445: "SMB (partage de fichiers)", 1900: "SSDP/UPnP",
    3306: "MySQL", 3389: "Bureau à distance (RDP)", 5040: "Service Windows (CDP)",
    5050: "Service Windows", 5353: "mDNS", 5355: "LLMNR", 5357: "WSD (découverte réseau)",
    5432: "PostgreSQL", 5900: "VNC", 7680: "Optimisation de la distribution", 8080: "HTTP (alternatif)",
    27017: "MongoDB",
}
# Ports dont l'exposition au réseau mérite l'attention
SENSITIVE_PORTS = {21, 23, 135, 139, 445, 3389, 5900, 3306, 5432, 27017}
FAMILY = {socket.AF_INET: "IPv4", getattr(socket, "AF_INET6", -1): "IPv6"}
LINK = getattr(psutil, "AF_LINK", -1)


def interfaces() -> list:
    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    io = psutil.net_io_counters(pernic=True)
    out = []
    for name, entries in addrs.items():
        st = stats.get(name)
        c = io.get(name)
        ipv4 = [a.address for a in entries if a.family == socket.AF_INET]
        ipv6 = [a.address.split("%")[0] for a in entries if FAMILY.get(a.family) == "IPv6"]
        mac = next((a.address for a in entries if a.family == LINK), None)
        lname = name.lower()
        loopback = lname == "lo" or lname.startswith("loopback") or "127.0.0.1" in ipv4
        out.append({
            "name": name,
            "up": bool(st and st.isup),
            "speed": st.speed if st else 0,  # Mbit/s
            "mtu": st.mtu if st else 0,
            "ipv4": ipv4,
            "ipv6": ipv6,
            "mac": mac,
            "loopback": loopback,
            "sent": c.bytes_sent if c else 0,
            "recv": c.bytes_recv if c else 0,
            "errors": (c.errin + c.errout) if c else 0,
            "drops": (c.dropin + c.dropout) if c else 0,
        })
    out.sort(key=lambda i: (i["loopback"], not i["up"], -(i["recv"] + i["sent"])))
    return out


def _process_names() -> dict:
    names = {}
    for p in psutil.process_iter(["pid", "name"]):
        names[p.info["pid"]] = p.info["name"]
    return names


def connections() -> dict:
    try:
        conns = psutil.net_connections(kind="inet")
    except (psutil.AccessDenied, OSError) as exc:
        return {"error": str(exc), "listening": [], "states": [], "by_process": [], "remote": []}
    names = _process_names()
    listening, seen = [], set()
    states = Counter()
    by_process = Counter()
    remote = Counter()
    for c in conns:
        proto = "TCP" if c.type == socket.SOCK_STREAM else "UDP"
        if c.status == psutil.CONN_LISTEN or (proto == "UDP" and not c.raddr):
            if not c.laddr:
                continue
            ip, port = c.laddr.ip, c.laddr.port
            key = (proto, ip, port)
            if key in seen:
                continue
            seen.add(key)
            exposed = ip in ("0.0.0.0", "::") or not (ip.startswith("127.") or ip == "::1")
            listening.append({
                "proto": proto, "ip": ip, "port": port, "pid": c.pid,
                "process": names.get(c.pid, "") if c.pid else "",
                "service": KNOWN_PORTS.get(port, ""),
                "exposed": exposed,
                "sensitive": exposed and port in SENSITIVE_PORTS and proto == "TCP",
            })
        elif proto == "TCP":
            states[c.status] += 1
            if c.status == psutil.CONN_ESTABLISHED:
                by_process[names.get(c.pid, "?") if c.pid else "Système"] += 1
                if c.raddr and not c.raddr.ip.startswith(("127.", "::1")):
                    remote[c.raddr.port] += 1
    listening.sort(key=lambda r: (r["proto"], r["port"]))
    return {
        "listening": listening,
        "states": states.most_common(),
        "by_process": by_process.most_common(10),
        "remote_ports": [(KNOWN_PORTS.get(p, str(p)), n) for p, n in remote.most_common(8)],
    }


WIFI_KEYS = {  # libellé netsh normalisé (sans accents, minuscules) -> clé
    "ssid": "ssid", "bssid": "bssid", "signal": "signal",
    "type de radio": "radio", "radio type": "radio", "bande": "band", "band": "band",
    "canal": "channel", "channel": "channel",
    "debit de reception (mbits/s)": "rx_rate", "receive rate (mbps)": "rx_rate",
    "debit de transmission (mbits/s)": "tx_rate", "transmit rate (mbps)": "tx_rate",
    "authentification": "auth", "authentication": "auth", "chiffrement": "cipher", "cipher": "cipher",
    "etat": "state", "state": "state", "description": "adapter",
}


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().strip().lower()


def parse_netsh_wlan(text: str) -> dict:
    info = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        k = WIFI_KEYS.get(_normalize(key))
        if k and k not in info:
            info[k] = value.strip()
    if not info.get("ssid"):
        return None
    sig = re.search(r"(\d+)", info.get("signal", ""))
    out = {"ssid": info["ssid"], "signal": int(sig.group(1)) if sig else None}
    for k in ("bssid", "radio", "band", "channel", "auth", "cipher", "state", "adapter"):
        out[k] = info.get(k)
    for k in ("rx_rate", "tx_rate"):
        m = re.search(r"[\d.,]+", info.get(k, ""))
        out[k] = float(m.group(0).replace(",", ".")) if m else None
    return out


def wifi() -> dict:
    """Connexion Wi-Fi active via netsh (libellés français ou anglais)."""
    if not IS_WINDOWS:
        return None
    try:
        proc = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True,
                              stdin=subprocess.DEVNULL, timeout=10, creationflags=NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return parse_netsh_wlan(proc.stdout.decode("oem", errors="replace"))


def config() -> dict:
    if not IS_WINDOWS:
        return {}
    try:
        raw = run_script("network", timeout=45)
    except Exception as exc:
        return {"errors": [str(exc)]}
    return {
        "profiles": as_list(raw.get("profiles")),
        "dns": [{**d, "servers": as_list(d.get("servers"))} for d in as_list(raw.get("dns"))],
        "gateways": as_list(raw.get("gateways")),
        "errors": as_list(raw.get("errors")),
    }


def collect() -> dict:
    """Partie rapide (psutil) ; la configuration PowerShell est mise en cache à part."""
    return {
        "interfaces": interfaces(),
        "connections": connections(),
        "wifi": wifi(),
        "hostname": socket.gethostname(),
    }
