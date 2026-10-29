@echo off
pushd "%~dp0"
chcp 65001 > nul
powershell -NoProfile -ExecutionPolicy Bypass -File ".\server.ps1"
popd
pause
