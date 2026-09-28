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
echo Release command completed successfully.
goto :finish

:build_failed
echo Release command failed with exit code %buildExitCode%.
echo See the details above. This command builds the desktop release.
echo For a browser UI preview, use runStart.cmd.

:finish
echo.
pause
popd
endlocal & exit /b %buildExitCode%
