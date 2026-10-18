@echo off
chcp 65001 >nul
echo جاري إيقاف سيرفر الجيم...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo تم إيقاف السيرفر بنجاح.
timeout /t 2 >nul
