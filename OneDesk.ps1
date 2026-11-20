# OneDesk Native Desktop Launcher (Smart App Control Compatible)
# Runs MwbDesktopApp.cs in-memory inside Microsoft's signed PowerShell host using .NET Add-Type
$ErrorActionPreference = "SilentlyContinue"
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BaseDir

# Remove Mark-of-the-Web (Zone.Identifier) from project files if downloaded via browser
Get-ChildItem -Path $BaseDir -Recurse | Unblock-File -ErrorAction SilentlyContinue

# Ensure Node dependencies are installed if missing
if ((Test-Path "$BaseDir\host-server\package.json") -and -not (Test-Path "$BaseDir\host-server\node_modules")) {
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
