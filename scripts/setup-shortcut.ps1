$nodeInstalled = $false
try {
    $nodeVer = & node -v 2>$null
    if ($nodeVer -match "v\d+") { $nodeInstalled = $true }
} catch {
    $nodeInstalled = $false
}

if (-not $nodeInstalled) {
    Write-Host "[ERROR] Node.js is not installed on this computer!" -ForegroundColor Red
    Write-Host "This system requires Node.js v22 or newer." -ForegroundColor Yellow
    Write-Host "Opening download page..." -ForegroundColor Cyan
    try {
        (New-Object -ComObject WScript.Shell).Popup("Node.js is not installed on this PC.`nPlease install Node.js (v22 or newer).`nOpening download page now...", 5, "Gym System Setup", 48)
    } catch {}
    Start-Process "https://nodejs.org/"
    exit 1
}

$projectDir = (Split-Path -Parent $PSScriptRoot)
$targetVbs = Join-Path $projectDir "Launch-Gym.vbs"

$sh = New-Object -ComObject Shell.Application
$desk = $sh.Namespace('shell:Desktop').Self.Path

$localLnk = Join-Path $projectDir "Gym-System.lnk"
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($localLnk)
$sc.TargetPath = "wscript.exe"
$sc.Arguments = "`"$targetVbs`""
$sc.WorkingDirectory = $projectDir
$sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,43"
$sc.Description = "Gym Management System"
$sc.Save()

$destLnk = Join-Path $desk "Gym-System.lnk"
Copy-Item $localLnk -Destination $destLnk -Force
Remove-Item $localLnk -Force -ErrorAction SilentlyContinue

if (Test-Path $destLnk) {
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " SUCCESS: Gym-System desktop shortcut created successfully!" -ForegroundColor Green
    Write-Host " You can now double click Gym-System on your Desktop." -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Green
    try {
        (New-Object -ComObject WScript.Shell).Popup("Gym System is ready!`nShortcut created on your Desktop.", 5, "Gym System", 64)
    } catch {}
    exit 0
} else {
    Write-Host "Failed to create shortcut." -ForegroundColor Red
    exit 1
}
