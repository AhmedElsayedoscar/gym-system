# التحقق من أن السيرفر يعمل
$serverRunning = $false
try {
    $res = Invoke-WebRequest -Uri "http://localhost:3000/api/public/card/1001" -TimeoutSec 1 -ErrorAction SilentlyContinue
    if ($res.StatusCode -in 200, 401, 404) { $serverRunning = $true }
} catch {
    $serverRunning = $true
}

if (-not $serverRunning) {
    Write-Host "[1/3] جاري تشغيل سيرفر الجيم المحلي..." -ForegroundColor Cyan
    Start-Process -FilePath "node" -ArgumentList "server.js" -WindowStyle Hidden
    Start-Sleep -Seconds 1
} else {
    Write-Host "[1/3] سيرفر الجيم يعمل بالفعل." -ForegroundColor Green
}

Write-Host "[2/3] جاري إنشاء رابط خارجي آمن (Cloudflare Tunnel)..." -ForegroundColor Cyan

$cloudflaredPath = Join-Path $PSScriptRoot "..\bin\cloudflared.exe"
if (-not (Test-Path $cloudflaredPath)) {
    Write-Host "خطأ: لم يتم العثور على أداة cloudflared في: $cloudflaredPath" -ForegroundColor Red
    return
}

# تشغيل cloudflared واستخراج الرابط
$dataDir = Join-Path $PSScriptRoot "..\data"
if (!(Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
$logFile = Join-Path $dataDir "tunnel.log"
if (Test-Path $logFile) { Remove-Item $logFile -Force }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $cloudflaredPath
$psi.Arguments = "tunnel --url http://localhost:3000"
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)

$tunnelUrl = $null
$startTime = Get-Date

while (($proc -ne $null) -and (-not $proc.HasExited) -and ($tunnelUrl -eq $null)) {
    $line = $proc.StandardError.ReadLine()
    if ($line) {
        Add-Content -Path $logFile -Value $line
        if ($line -match "https://[a-zA-Z0-9\-\.]+\.trycloudflare\.com") {
            $tunnelUrl = $matches[0]
            break
        }
    }
    if ((Get-Date) - $startTime -gt [TimeSpan]::FromSeconds(25)) { break }
}

if ($tunnelUrl) {
    Set-Clipboard -Value $tunnelUrl
    Write-Host ""
    Write-Host "=======================================================================" -ForegroundColor Green
    Write-Host "          تم تشغيل سيستم الجيم عبر الإنترنت بنجاح! 🚀" -ForegroundColor Green
    Write-Host "=======================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host " 🌐 رابط السيستم الخارجي (تم نسخه تلقائياً للحافظة):" -ForegroundColor Yellow
    Write-Host "    $tunnelUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host " 💡 يمكنك إرسال كروت المشتركين بروابط تعمل من أي موبايل خارج الجيم." -ForegroundColor White
    Write-Host " ⚠️  اترك هذه النافذة مفتوحة طوال فترة عملك للحفاظ على الرابط فعالاً." -ForegroundColor Magenta
    Write-Host " 🛑 لإيقاف السيستم والرابط: اضغط على Stop-Gym.bat أو أغلق هذه النافذة." -ForegroundColor Gray
    Write-Host "=======================================================================" -ForegroundColor Green
    Write-Host ""
    
    Start-Process $tunnelUrl
    $proc.WaitForExit()
} else {
    Write-Host "تعذر الحصول على الرابط. تحقق من الاتصال بالإنترنت." -ForegroundColor Red
}
