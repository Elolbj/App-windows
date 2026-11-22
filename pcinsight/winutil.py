"""Fonctions utilitaires spécifiques à Windows (registre, droits admin, dossiers).

Toutes les fonctions renvoient une valeur neutre (None, [], {}) hors Windows,
ce qui permet de lancer l'application en mode démo sous Linux/macOS.
"""

import ctypes
import os
import subprocess
import sys
from pathlib import Path

IS_WINDOWS = sys.platform == "win32"

if IS_WINDOWS:
    import winreg

    HKLM = winreg.HKEY_LOCAL_MACHINE
    HKCU = winreg.HKEY_CURRENT_USER
    VIEW_64 = winreg.KEY_WOW64_64KEY
    VIEW_32 = winreg.KEY_WOW64_32KEY
else:  # valeurs factices pour que le code s'importe partout
    winreg = None
    HKLM = HKCU = VIEW_64 = VIEW_32 = 0

# Empêche l'ouverture d'une fenêtre console pour chaque sous-processus
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def resource_dir() -> Path:
    """Dossier du paquet pcinsight, y compris dans un exécutable PyInstaller."""
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return Path(base) / "pcinsight"
    return Path(__file__).resolve().parent


def app_data_dir() -> Path:
    """Dossier des données persistantes (historique, journaux)."""
    root = os.environ.get("LOCALAPPDATA") if IS_WINDOWS else None
    path = Path(root) / "PCInsight" if root else Path.home() / ".pcinsight"
    path.mkdir(parents=True, exist_ok=True)
    return path


def documents_dir() -> Path:
    """Dossier « Documents » de l'utilisateur (redirection OneDrive comprise)."""
    if IS_WINDOWS:
        try:
            buf = ctypes.create_unicode_buffer(260)
            # CSIDL_PERSONAL = 5 -> Documents
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0:
                return Path(buf.value)
        except OSError:
            pass
    docs = Path.home() / "Documents"
    return docs if docs.exists() else Path.home()


def is_admin() -> bool:
    if not IS_WINDOWS:
        return hasattr(os, "geteuid") and os.geteuid() == 0
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except OSError:
        return False


def relaunch_as_admin() -> bool:
    """Relance l'application avec élévation UAC. Renvoie True si la demande a été acceptée."""
    if not IS_WINDOWS:
        return False
    if getattr(sys, "frozen", False):  # exécutable PyInstaller
        exe, params = sys.executable, subprocess.list2cmdline(sys.argv[1:])
    else:
        exe, params = sys.executable, subprocess.list2cmdline(["-m", "pcinsight", *sys.argv[1:]])
    # ShellExecuteW renvoie une valeur > 32 en cas de succès
    rc = ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, params, None, 1)
    return rc > 32


def open_path(path) -> None:
    path = str(path)
    if IS_WINDOWS:
        os.startfile(path)  # noqa: S606 - chemin produit par l'application
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


# --------------------------------------------------------------------------- registre

def _open_key(root, path, view=0):
    return winreg.OpenKey(root, path, 0, winreg.KEY_READ | view)


def reg_value(root, path, name, default=None, view=0):
    """Lit une valeur du registre ; renvoie `default` si la clé ou la valeur n'existe pas."""
    if not IS_WINDOWS:
        return default
    try:
        with _open_key(root, path, view) as key:
            value, _ = winreg.QueryValueEx(key, name)
            return value
    except OSError:
        return default


def reg_values(root, path, view=0) -> dict:
    """Toutes les valeurs d'une clé sous forme de dictionnaire."""
    if not IS_WINDOWS:
        return {}
    out = {}
    try:
        with _open_key(root, path, view) as key:
            i = 0
            while True:
                try:
                    name, value, _ = winreg.EnumValue(key, i)
                except OSError:
                    break
                out[name] = value
                i += 1
    except OSError:
        pass
    return out


def reg_subkeys(root, path, view=0) -> list:
    if not IS_WINDOWS:
        return []
    out = []
    try:
        with _open_key(root, path, view) as key:
            i = 0
            while True:
                try:
                    out.append(winreg.EnumKey(key, i))
                except OSError:
                    break
                i += 1
    except OSError:
        pass
    return out


def reg_key_exists(root, path, view=0) -> bool:
    if not IS_WINDOWS:
        return False
    try:
        with _open_key(root, path, view):
            return True
    except OSError:
        return False
