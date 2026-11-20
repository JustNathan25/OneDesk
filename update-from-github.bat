@echo off
title OneDesk - GitHub Auto-Updater
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-OneDesk.ps1"
