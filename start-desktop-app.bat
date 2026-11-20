@echo off
title Mouse Without Borders - Native Desktop Application (OS Input Capture + E2EE Relay)
cd /d "%~dp0host-server"

echo [1/3] Compiling Native Windows Input Capture ^& Injection Service (MwbInputDriver.exe)...
if exist "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" (
  "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /out:"%~dp0host-server\MwbInputDriver.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0host-server\MwbInputDriver.cs"
)

echo [2/3] Launching Native Desktop App Window (http://127.0.0.1:8765)...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'; $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'; if (Test-Path $edge) { Start-Process $edge '--app=http://127.0.0.1:8765 --window-size=1180,760' } elseif (Test-Path $chrome) { Start-Process $chrome '--app=http://127.0.0.1:8765 --window-size=1180,760' } else { Start-Process 'http://127.0.0.1:8765' }"

echo [3/3] Starting Native OS Hook ^& Encrypted Transport Service...
node server.js
pause
