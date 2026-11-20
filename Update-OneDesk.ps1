# OneDesk Auto-Updater & Desktop Shortcut Installer (Works WITH or WITHOUT Git installed!)
$ErrorActionPreference = "SilentlyContinue"
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BaseDir

# Ensure Node.js & Git standard paths are in session PATH
if (Test-Path "C:\Program Files\nodejs") { $env:PATH = "C:\Program Files\nodejs;" + $env:PATH }
if (Test-Path "C:\Program Files\Git\cmd") { $env:PATH = "C:\Program Files\Git\cmd;" + $env:PATH }

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
Start-Sleep -Milliseconds 800

Write-Host "[2/4] Downloading latest OneDesk update from GitHub (https://github.com/JustNathan25/OneDesk)..." -ForegroundColor Cyan
$HasGit = [bool](Get-Command git -ErrorAction SilentlyContinue)

if ($HasGit) {
    if (-not (Test-Path "$BaseDir\.git")) {
        git init
        git remote add origin https://github.com/JustNathan25/OneDesk.git
    }
    git fetch origin main
    git reset --hard origin/main
    $LatestSha = (git rev-parse HEAD).Trim()
    if ($LatestSha) { Set-Content -Path "$BaseDir\.onedesk-commit" -Value $LatestSha }
} else {
    # Git is NOT installed on this device -> Download directly from GitHub Archive ZIP!
    Write-Host "      (Git not installed — downloading direct ZIP archive from GitHub...)" -ForegroundColor Yellow
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ZipPath = Join-Path $env:TEMP "OneDesk-main.zip"
    $ExtractDir = Join-Path $env:TEMP "OneDesk-extract"
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    if (Test-Path $ExtractDir) { Remove-Item $ExtractDir -Recurse -Force }

    Invoke-WebRequest -Uri "https://github.com/JustNathan25/OneDesk/archive/refs/heads/main.zip" -OutFile $ZipPath -UseBasicParsing
    Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

    $InnerFolder = Join-Path $ExtractDir "OneDesk-main"
    if (Test-Path $InnerFolder) {
        Copy-Item -Path "$InnerFolder\*" -Destination $BaseDir -Recurse -Force
    }
    try {
        $ApiResp = Invoke-RestMethod -Uri "https://api.github.com/repos/JustNathan25/OneDesk/commits/main" -Headers @{ "User-Agent" = "OneDesk-Updater" }
        if ($ApiResp.sha) { Set-Content -Path "$BaseDir\.onedesk-commit" -Value $ApiResp.sha }
    } catch {}
}

Get-ChildItem -Path $BaseDir -Recurse | Unblock-File -ErrorAction SilentlyContinue

if ((Test-Path "$BaseDir\host-server\package.json") -and -not (Test-Path "$BaseDir\host-server\node_modules\ws")) {
    Write-Host "[3/4] Installing Node dependencies (ws, mqtt)..." -ForegroundColor Cyan
    Set-Location "$BaseDir\host-server"
    cmd.exe /c "npm install --no-audit --no-fund"
    Set-Location $BaseDir
}

# Also sync to %LOCALAPPDATA%\Programs\OneDesk if installed there and we ran from Desktop/Downloads
$InstalledDir = Join-Path $env:LOCALAPPDATA "Programs\OneDesk"
if ((Test-Path $InstalledDir) -and ($BaseDir.TrimEnd('\') -ne $InstalledDir.TrimEnd('\'))) {
    Write-Host "      Syncing updated files to installed folder ($InstalledDir)..." -ForegroundColor Cyan
    Copy-Item -Path "$BaseDir\*.cs", "$BaseDir\*.ps1", "$BaseDir\*.bat" -Destination $InstalledDir -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "$BaseDir\host-server\*.js", "$BaseDir\host-server\*.cs", "$BaseDir\host-server\*.json" -Destination "$InstalledDir\host-server" -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "$BaseDir\chrome-extension\*" -Destination "$InstalledDir\chrome-extension" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[4/4] Relaunching OneDesk..." -ForegroundColor Green
$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath('Desktop')
$Shortcut = $WshShell.CreateShortcut((Join-Path $Desktop 'OneDesk.lnk'))
$Shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BaseDir\OneDesk.ps1`""
$Shortcut.WorkingDirectory = $BaseDir
$Shortcut.Description = "OneDesk - Seamless Multi-PC Mouse & Keyboard"
$Shortcut.Save()

Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BaseDir\OneDesk.ps1`"" -WorkingDirectory $BaseDir
