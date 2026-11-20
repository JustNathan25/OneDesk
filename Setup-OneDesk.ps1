# OneDesk Graphical Windows Setup Wizard Launcher (Smart App Control Compatible)
$ErrorActionPreference = "SilentlyContinue"
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BaseDir

Get-ChildItem -Path $BaseDir -Recurse | Unblock-File -ErrorAction SilentlyContinue

$InstallerCs = Join-Path $BaseDir "OneDeskInstaller.cs"
$Code = [System.IO.File]::ReadAllText($InstallerCs)
Add-Type -TypeDefinition $Code -ReferencedAssemblies System.Windows.Forms, System.Drawing -Language CSharp
[OneDeskInstallerForm]::Main()
