"""Inventaire matériel : processeur, carte graphique, mémoire, carte mère, disques, batterie..."""

from ..ps import as_list, run_script
from ..winutil import HKLM, VIEW_64, reg_subkeys, reg_values

MEMORY_TYPES = {20: "DDR", 21: "DDR2", 24: "DDR3", 26: "DDR4", 27: "LPDDR", 28: "LPDDR2",
                29: "LPDDR3", 30: "LPDDR4", 34: "DDR5", 35: "LPDDR5"}
MEDIA_TYPES = {3: "HDD", 4: "SSD", 5: "SCM"}
BUS_TYPES = {1: "SCSI", 2: "ATAPI", 3: "ATA", 7: "USB", 8: "RAID", 9: "iSCSI", 10: "SAS",
             11: "SATA", 12: "SD", 13: "MMC", 14: "Virtuel", 15: "Virtuel", 16: "Espaces de stockage",
             17: "NVMe", 18: "SCM", 19: "UFS"}
HEALTH = {0: "Bon", 1: "Avertissement", 2: "Défaillant", 5: "Inconnu"}
BATTERY_STATUS = {1: "Sur batterie", 2: "Secteur", 3: "Chargée", 4: "Faible", 5: "Critique",
                  6: "En charge", 7: "En charge", 8: "En charge", 9: "En charge", 11: "Partiellement chargée"}
DEVICE_ERRORS = {
    1: "Mal configuré", 3: "Pilote corrompu ou mémoire insuffisante", 10: "Impossible de démarrer",
    12: "Ressources insuffisantes", 14: "Redémarrage requis", 18: "Pilote à réinstaller",
    19: "Registre corrompu", 21: "Suppression en cours", 22: "Désactivé", 24: "Absent ou mal installé",
    28: "Pilote non installé", 29: "Désactivé par le firmware", 31: "Ne fonctionne pas correctement",
    32: "Service du pilote désactivé", 37: "Échec de l'initialisation du pilote",
    39: "Pilote manquant ou corrompu", 43: "Arrêté (problème signalé)", 45: "Non connecté",
    52: "Signature du pilote invalide",
}
PC_TYPES = {1: "Ordinateur de bureau", 2: "Ordinateur portable", 3: "Station de travail",
            4: "Serveur", 5: "Serveur", 8: "Tablette"}

GPU_CLASS = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"


def gpu_memory_from_registry() -> dict:
    """VRAM réelle : Win32_VideoController.AdapterRAM est limité à 4 Go (entier 32 bits)."""
    out = {}
    for sub in reg_subkeys(HKLM, GPU_CLASS, VIEW_64):
        if not sub.isdigit():
            continue
        vals = reg_values(HKLM, f"{GPU_CLASS}\\{sub}", VIEW_64)
        name = vals.get("DriverDesc")
        size = vals.get("HardwareInformation.qwMemorySize") or vals.get("HardwareInformation.MemorySize")
        if isinstance(size, (bytes, bytearray)):
            size = int.from_bytes(size[:8], "little")
        if name and isinstance(size, int) and size > 0:
            out[name] = size
    return out


def collect() -> dict:
    raw = run_script("hardware", timeout=90)
    vram = gpu_memory_from_registry()

    system = raw.get("system") or {}
    system["type_label"] = PC_TYPES.get(system.get("pcSystemType"), "Inconnu")

    gpus = as_list(raw.get("gpu"))
    for g in gpus:
        g["memory"] = vram.get(g.get("name")) or g.get("adapterRAM") or 0

    modules = as_list(raw.get("memoryModules"))
    for m in modules:
        m["type"] = MEMORY_TYPES.get(m.get("smbiosType"), "")

    reliability = {r.get("deviceId"): r for r in as_list(raw.get("diskReliability"))}
    disks = as_list(raw.get("physicalDisks"))
    for d in disks:
        d["media"] = MEDIA_TYPES.get(d.get("mediaType"), "Inconnu")
        if d["media"] == "Inconnu" and d.get("spindle") == 0:
            d["media"] = "SSD"  # pas de rotation -> mémoire flash
        d["bus"] = BUS_TYPES.get(d.get("busType"), "Autre")
        d["health_label"] = HEALTH.get(d.get("health"), "Inconnu")
        d["reliability"] = reliability.get(d.get("deviceId"))

    batteries = as_list(raw.get("battery"))
    for b in batteries:
        b["status_label"] = BATTERY_STATUS.get(b.get("status"), "Inconnu")
        design, full = b.get("designCapacity"), b.get("fullCapacity")
        b["health"] = round(100 * full / design, 1) if design and full else None

    problems = []
    for p in as_list(raw.get("problemDevices")):
        p["label"] = DEVICE_ERRORS.get(p.get("code"), f"Code {p.get('code')}")
        p["disabled"] = p.get("code") == 22
        problems.append(p)

    arr = raw.get("memoryArray") or {}
    return {
        "system": system,
        "os": raw.get("os") or {},
        "cpu": as_list(raw.get("cpu")),
        "gpu": gpus,
        "memory": {
            "modules": modules,
            "slots": arr.get("slots") or 0,
            "max_capacity": (arr.get("maxCapacityKB") or 0) * 1024,
            "total": sum(m.get("capacity") or 0 for m in modules),
        },
        "board": raw.get("board") or {},
        "bios": raw.get("bios") or {},
        "disks": disks,
        "battery": batteries,
        "monitors": [m for m in as_list(raw.get("monitors")) if m.get("name") or m.get("manufacturer")],
        "network_adapters": as_list(raw.get("networkAdapters")),
        "sound": as_list(raw.get("sound")),
        "problem_devices": problems,
        "errors": as_list(raw.get("errors")),
    }
