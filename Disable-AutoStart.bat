@echo off
title Gym System Disable AutoStart
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\disable-autostart.ps1"
