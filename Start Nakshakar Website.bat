@echo off
title Nakshakar website
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to run the website. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing, this takes a minute or two...
  call npm install --no-fund --no-audit
)
if not exist dist\index.html (
  echo Preparing the website...
  call npx vite build
)

echo.
echo  Nakshakar is opening in your browser at http://localhost:4173
echo  Keep this window open while you use it. Close it when you are finished.
echo  Your projects stay saved in this browser on this laptop.
echo.
start "" http://localhost:4173
call npx vite preview --port 4173 --strictPort
