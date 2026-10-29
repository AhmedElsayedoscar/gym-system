$localLnk = Join-Path $PSScriptRoot "Gym-System.lnk"
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($localLnk)
$targetVbs = Join-Path (Split-Path -Parent $PSScriptRoot) "Launch-Gym.vbs"
$sc.TargetPath = "wscript.exe"
$sc.Arguments = "`"$targetVbs`""
$sc.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,43"
$sc.Description = "Gym Management System"
$sc.Save()

$sh = New-Object -ComObject Shell.Application
$desk = $sh.Namespace('shell:Desktop').Self.Path
Copy-Item $localLnk -Destination (Join-Path $desk "Gym-System.lnk") -Force
Remove-Item $localLnk -Force -ErrorAction SilentlyContinue

$copied = Test-Path (Join-Path $desk "Gym-System.lnk")
Write-Output "RESULT: $copied"
