@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    py -3.12 -m venv .venv || py -3.11 -m venv .venv || goto python_error
)
if not exist ".venv\studio-multilingual-dependencies.ready" (
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto install_error
    type nul > ".venv\studio-multilingual-dependencies.ready"
)
".venv\Scripts\python.exe" run.py
if errorlevel 1 pause
exit /b
:python_error
echo Install 64-bit Python 3.11 or 3.12, then launch this file again.
pause
exit /b 1
:install_error
echo Setup failed. Check the error above, then launch again to retry.
pause
exit /b 1
