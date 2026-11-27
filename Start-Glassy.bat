@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist "dist\index.html" (
  echo Building Glassy for first launch...
  call npm run build
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
