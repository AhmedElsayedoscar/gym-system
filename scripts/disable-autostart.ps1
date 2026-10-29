$startup = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$lnk = Join-Path $startup 'Gym-System.lnk'

if (Test-Path $lnk) {
    Remove-Item $lnk -Force
    Write-Host "Auto-start disabled successfully." -ForegroundColor Yellow
    try {
        (New-Object -ComObject WScript.Shell).Popup("تم إلغاء التشغيل التلقائي بنجاح.", 4, "Gym System", 64)
    } catch {}
} else {
    Write-Host "Auto-start was not enabled." -ForegroundColor Gray
}
