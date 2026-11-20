@echo off
title OneDesk / Mouse Without Borders - GitHub Auto-Updater
cd /d "%~dp0"

echo [1/4] Stopping running OneDesk / Mouse Without Borders processes...
powershell -NoProfile -Command "Stop-Process -Name 'MouseWithoutBordersApp', 'MwbInputDriver' -Force -ErrorAction SilentlyContinue; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul

echo [2/4] Pulling latest updates from GitHub (https://github.com/JustNathan25/OneDesk.git)...
if not exist "%~dp0.git" (
  git init
  git remote add origin https://github.com/JustNathan25/OneDesk.git
)
git fetch origin main
git reset --hard origin/main

if exist "%~dp0host-server\package.json" (
  if not exist "%~dp0host-server\node_modules" (
    echo Installing Node dependencies...
    cd /d "%~dp0host-server"
    call npm install
    cd /d "%~dp0"
  )
)

echo [3/4] Recompiling Native Windows Desktop App ^& OS Input Hook Driver...
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:"%~dp0MouseWithoutBordersApp.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0MwbDesktopApp.cs"
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /out:"%~dp0host-server\MwbInputDriver.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0host-server\MwbInputDriver.cs"

echo [4/4] Relaunching Updated MouseWithoutBordersApp.exe...
start "" "%~dp0MouseWithoutBordersApp.exe"
exit
