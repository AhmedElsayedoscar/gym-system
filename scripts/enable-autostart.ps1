$startup = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$sh = New-Object -ComObject Shell.Application
$desk = $sh.Namespace('shell:Desktop').Self.Path
$deskLnk = Join-Path $desk 'Gym-System.lnk'

if (Test-Path $deskLnk) {
    Copy-Item $deskLnk -Destination (Join-Path $startup 'Gym-System.lnk') -Force
    Write-Host "Auto-start enabled successfully!" -ForegroundColor Green
    try {
        (New-Object -ComObject WScript.Shell).Popup("تم تفعيل تشغيل البرنامج تلقائياً عند فتح الجهاز بنجاح!", 4, "Gym System", 64)
    } catch {}
} else {
    Write-Host "Please run Setup-Shortcut.bat first!" -ForegroundColor Yellow
}
