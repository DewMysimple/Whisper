@echo off
cd /d "%~dp0" || (
  echo Failed to enter the project directory.
  pause
  exit /b 1
)
call corepack pnpm --filter @whisper-subtitle/web dev --open
set "launch_exit=%errorlevel%"
if not "%launch_exit%"=="0" pause
exit /b %launch_exit%
