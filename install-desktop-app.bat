@echo off
title OneDesk Setup Wizard
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Setup-OneDesk.ps1"
