@echo off
title Mouse Without Borders (OneDesk) - Native Desktop Installer
cd /d "%~dp0"

if exist "%~dp0host-server\package.json" (
  if not exist "%~dp0host-server\node_modules" (
    echo [0/3] Installing Node dependencies...
    cd /d "%~dp0host-server"
    call npm install
    cd /d "%~dp0"
  )
)

echo [1/3] Compiling Native Windows Desktop Software (MouseWithoutBordersApp.exe)...
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:"%~dp0MouseWithoutBordersApp.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0MwbDesktopApp.cs"

echo [2/3] Compiling Native OS Input Hook Service (MwbInputDriver.exe)...
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /out:"%~dp0host-server\MwbInputDriver.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0host-server\MwbInputDriver.cs"

echo [3/3] Creating Desktop Shortcut for MouseWithoutBordersApp.exe...
powershell -NoProfile -Command "$WshShell = New-Object -ComObject WScript.Shell; $Desktop = [Environment]::GetFolderPath('Desktop'); $Shortcut = $WshShell.CreateShortcut((Join-Path $Desktop 'Mouse Without Borders.lnk')); $Shortcut.TargetPath = '%~dp0MouseWithoutBordersApp.exe'; $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.Description = 'Mouse Without Borders Native Desktop App'; $Shortcut.Save()"

echo.
echo ============================================================
echo   INSTALLED: MouseWithoutBordersApp.exe
echo   Shortcut created on your Windows Desktop!
echo ============================================================
start "" "%~dp0MouseWithoutBordersApp.exe"
