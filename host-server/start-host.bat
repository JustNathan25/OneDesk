@echo off
title Mouse Without Borders - Native Desktop Service (LAN + Encrypted Internet Relay)
cd /d "%~dp0"
if exist "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" (
  "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /out:"%~dp0MwbInputDriver.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0MwbInputDriver.cs"
)
echo Starting Native Desktop Service...
node server.js
pause
