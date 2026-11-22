@echo off
rem Lance PC Insight (installe les dependances au premier lancement).
setlocal
cd /d "%~dp0"
set "PY=python"
set "PYW=pythonw"
where py >nul 2>nul && (set "PY=py" & set "PYW=pyw")
%PY% -c "import psutil, webview" >nul 2>nul
if errorlevel 1 (
  echo Installation des dependances...
  %PY% -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Echec de l'installation. Python 3.10+ est-il installe ?
    pause
    exit /b 1
  )
)
start "" %PYW% -m pcinsight %*
