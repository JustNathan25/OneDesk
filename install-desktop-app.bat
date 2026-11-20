@echo off
title OneDesk - Smart App Control Compatible Installer
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-OneDesk.ps1"
