# OneDesk Auto-Updater & Desktop Shortcut Installer (Smart App Control Compatible)
$ErrorActionPreference = "SilentlyContinue"
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BaseDir

Write-Host "[1/4] Unblocking files & stopping existing OneDesk session..." -ForegroundColor Cyan
Get-ChildItem -Path $BaseDir -Recurse | Unblock-File -ErrorAction SilentlyContinue

Stop-Process -Name "MouseWithoutBordersApp", "MwbInputDriver" -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.js*') -or
    ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*OneDesk.ps1*') -or
    ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*MwbInputDriver.cs*')
} | ForEach-Object {
    if ($_.ProcessId -ne $PID) {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Milliseconds 700

Write-Host "[2/4] Pulling latest commits from GitHub (https://github.com/JustNathan25/OneDesk.git)..." -ForegroundColor Cyan
if (-not (Test-Path "$BaseDir\.git")) {
    git init
    git remote add origin https://github.com/JustNathan25/OneDesk.git
}
git fetch origin main
git reset --hard origin/main
Get-ChildItem -Path $BaseDir -Recurse | Unblock-File -ErrorAction SilentlyContinue

if ((Test-Path "$BaseDir\host-server\package.json") -and -not (Test-Path "$BaseDir\host-server\node_modules")) {
    Write-Host "[3/4] Installing Node dependencies..." -ForegroundColor Cyan
    Set-Location "$BaseDir\host-server"
    npm install
    Set-Location $BaseDir
}

Write-Host "[4/4] Creating Smart App Control-safe Desktop Shortcut & Launching OneDesk..." -ForegroundColor Green
$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath('Desktop')
$Shortcut = $WshShell.CreateShortcut((Join-Path $Desktop 'OneDesk.lnk'))
$Shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BaseDir\OneDesk.ps1`""
$Shortcut.WorkingDirectory = $BaseDir
$Shortcut.Description = "OneDesk - Seamless Multi-PC Mouse & Keyboard"
$Shortcut.Save()

Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BaseDir\OneDesk.ps1`"" -WorkingDirectory $BaseDir
