@echo off
title Video Editor Portfolio Server
cd /d "%~dp0"
echo Starting Video Editor Portfolio Local Server...
powershell -ExecutionPolicy Bypass -File .\server.ps1
pause
