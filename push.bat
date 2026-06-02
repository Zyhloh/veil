@echo off
setlocal enabledelayedexpansion

if "%~1"=="" (
    set /p MSG="Commit message: "
) else (
    set "MSG=%~1"
)

if "!MSG!"=="" (
    echo Aborted: empty commit message.
    exit /b 1
)

git add -A
if errorlevel 1 exit /b 1

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "!MSG!"
    if errorlevel 1 exit /b 1
) else (
    echo No staged changes. Pushing existing commits.
)

git push origin main
if errorlevel 1 (
    echo Push failed. Skipping installer build.
    exit /b 1
)

echo.
echo Push succeeded. Building installer...
echo.

call npm run tauri build
if errorlevel 1 (
    echo Installer build failed.
    exit /b 1
)

echo.
echo Installer ready at:
echo   src-tauri\target\release\bundle\nsis\Veil_*-setup.exe
echo   src-tauri\target\release\bundle\msi\Veil_*.msi
exit /b 0
