"""Exécution des scripts PowerShell fournis dans pcinsight/scripts.

Chaque script écrit son résultat JSON (UTF-8) dans un fichier temporaire passé
par -OutFile. Passer par un fichier évite tous les problèmes d'encodage de la
console (accents des messages Windows en français).
"""

import json
import os
import shutil
import subprocess
import tempfile

from .winutil import IS_WINDOWS, NO_WINDOW, resource_dir


class PowerShellError(RuntimeError):
    pass


def _powershell_exe() -> str:
    found = shutil.which("powershell.exe") or shutil.which("powershell")
    if found:
        return found
    windir = os.environ.get("SystemRoot", r"C:\Windows")
    return os.path.join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")


def run_script(name: str, timeout: int = 90, **params) -> dict:
    """Lance scripts/<name>.ps1 et renvoie le JSON produit sous forme de dict."""
    if not IS_WINDOWS:
        raise PowerShellError("PowerShell n'est disponible que sous Windows")

    script = resource_dir() / "scripts" / f"{name}.ps1"
    if not script.is_file():
        raise PowerShellError(f"Script introuvable : {script}")

    fd, out_file = tempfile.mkstemp(prefix="pcinsight_", suffix=".json")
    os.close(fd)
    cmd = [
        _powershell_exe(), "-NoProfile", "-NonInteractive",
        "-ExecutionPolicy", "Bypass", "-File", str(script), "-OutFile", out_file,
    ]
    for key, value in params.items():
        cmd += [f"-{key}", str(value)]

    try:
        proc = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,  # requis dans un exe PyInstaller sans console
            capture_output=True,
            timeout=timeout,
            creationflags=NO_WINDOW,
        )
        with open(out_file, encoding="utf-8-sig") as f:
            text = f.read().strip()
        if not text:
            err = proc.stderr.decode("utf-8", errors="replace").strip()
            raise PowerShellError(f"{name}.ps1 n'a rien renvoyé (code {proc.returncode}) {err[:500]}")
        return json.loads(text)
    except subprocess.TimeoutExpired as exc:
        raise PowerShellError(f"{name}.ps1 a dépassé le délai de {timeout} s") from exc
    except json.JSONDecodeError as exc:
        raise PowerShellError(f"JSON invalide renvoyé par {name}.ps1 : {exc}") from exc
    finally:
        try:
            os.remove(out_file)
        except OSError:
            pass


def as_list(value) -> list:
    """PowerShell transforme un tableau d'un seul élément en objet : on normalise."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]
