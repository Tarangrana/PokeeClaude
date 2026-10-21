@echo off
rem Double-click to open PokeeClaude. First run installs dependencies,
rem then the setup window opens.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo PokeeClaude needs Node.js 20 or newer: https://nodejs.org
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing PokeeClaude ^(this takes a minute^)...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
if not exist dist\cli.js (
  call npm run build --silent || (pause & exit /b 1)
)

node dist\cli.js setup
