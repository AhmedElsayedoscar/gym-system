@echo off
chcp 65001 >nul
title تشغيل سيستم الجيم أونلاين (Cloudflare Tunnel)

echo ========================================================
echo        جاري تشغيل سيستم الجيم والرابط الخارجي...
echo ========================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-tunnel.ps1"

pause
