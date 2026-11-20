# OneDesk Native Desktop Launcher (Smart App Control Compatible)
# Runs MwbDesktopApp.cs in-memory inside Microsoft's signed PowerShell host using .NET Add-Type
$ErrorActionPreference = "SilentlyContinue"
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BaseDir

# Remove Mark-of-the-Web (Zone.Identifier) from project files if downloaded via browser
Get-ChildItem -Path $BaseDir -Recurse | Unblock-File -ErrorAction SilentlyContinue

# Ensure C:\Program Files\nodejs is in the current session PATH even if Node.js was just installed
if (Test-Path "C:\Program Files\nodejs") {
    $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
}

# If Node.js is completely missing on a brand-new PC, automatically install Node.js LTS via winget
if (-not (Get-Command node -ErrorAction SilentlyContinue) -and -not (Test-Path "C:\Program Files\nodejs\node.exe")) {
    Write-Host "Node.js not found. Installing Node.js LTS via winget..." -ForegroundColor Cyan
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
}

# Ensure Node dependencies are installed if missing (specifically check for node_modules\ws)
if ((Test-Path "$BaseDir\host-server\package.json") -and -not (Test-Path "$BaseDir\host-server\node_modules\ws")) {
    Set-Location "$BaseDir\host-server"
    cmd.exe /c "npm install --no-audit --no-fund" | Out-Null
    Set-Location $BaseDir
}

try {
    $CsPath = Join-Path $BaseDir "MwbDesktopApp.cs"
    $CsCode = [System.IO.File]::ReadAllText($CsPath)
    Add-Type -TypeDefinition $CsCode -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Net -Language CSharp
    [MwbDesktopAppForm]::Main()
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("OneDesk failed to launch: " + $_.Exception.Message, "OneDesk Error")
}
