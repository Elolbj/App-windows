@echo off
rem Construit dist\PCInsight\PCInsight.exe (aucune installation de Python requise ensuite).
setlocal
cd /d "%~dp0"
set "PY=python"
where py >nul 2>nul && set "PY=py"
%PY% -m pip install -r requirements-dev.txt || exit /b 1
%PY% -m PyInstaller --noconfirm --clean --windowed --name PCInsight --add-data "pcinsight/web;pcinsight/web" --add-data "pcinsight/scripts;pcinsight/scripts" main.py || exit /b 1
echo.
echo Executable : dist\PCInsight\PCInsight.exe
pause
