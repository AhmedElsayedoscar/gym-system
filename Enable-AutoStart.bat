@echo off
title Gym System AutoStart
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enable-autostart.ps1"
