@echo off
setlocal DisableDelayedExpansion

pushd "%~dp0"
if errorlevel 1 (
    echo Unable to open the WhisperSubtitle project directory.
    pause
    endlocal & exit /b 1
)

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\release\build.ps1" %*
set "buildExitCode=%errorlevel%"

echo.
if not "%buildExitCode%"=="0" goto :build_failed
echo Build completed successfully:
echo   %~dp0dist\WhisperSubtitle\WhisperSubtitle.exe
echo   %~dp0dist\WhisperSubtitle.zip
echo   %~dp0dist\WhisperSubtitle.sha256
goto :finish

:build_failed
echo Build failed with exit code %buildExitCode%.

:finish
echo.
pause
popd
endlocal & exit /b %buildExitCode%
