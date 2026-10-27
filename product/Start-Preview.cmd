@echo off
powershell.exe -NoProfile -File "%~dp0scripts\start-preview.ps1"
if errorlevel 1 pause
