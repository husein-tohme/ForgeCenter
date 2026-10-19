@echo off
rem Runs Forgehub on this computer for testing: http://localhost:3000
rem Needs Node.js 22 or newer from https://nodejs.org (the LTS button).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js isn't installed. Get it from https://nodejs.org, then run this again. & pause & exit /b)
if not exist node_modules (echo Installing, this takes a minute... & call npm install --omit=dev)
set DEV_LOGIN=1
set PORT=3000
start "" http://localhost:3000
node --disable-warning=ExperimentalWarning src/server.js
pause
