@echo off
pushd "%~dp0"
chcp 65001 > nul
powershell -NoProfile -ExecutionPolicy Bypass -File ".\server.ps1" -Port 3001 -Lan
popd
pause
