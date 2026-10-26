@echo off
chcp 65001 >nul
cd /d "%~dp0"
set GCM_CREDENTIAL_STORE=dpapi
set GCM_GUI_PROMPT=true
echo ==========================================
echo   Life OS - upload to GitHub
echo ==========================================
echo.
echo Repo: https://github.com/sixfeetas/life-os
echo Site: https://sixfeetas.github.io/life-os/
echo.
echo Step 1: Sign in to GitHub when the browser opens.
git credential-manager github login
if errorlevel 1 goto login_error
echo.
echo Saving the newest files...
echo Step 2: Save the latest version locally.
git add -A
if errorlevel 1 goto save_error
git diff --cached --quiet
if errorlevel 1 goto commit
echo No file changes to upload.
goto push

:commit
git commit -m "Life OS update"
if errorlevel 1 goto save_error

:push
echo.
echo Step 3: Upload to GitHub.
git pull --rebase origin main
if errorlevel 1 echo Remote main is not ready yet. Continuing with the first upload.
git -c http.sslBackend=openssl push -u origin main
if errorlevel 1 goto push_error
set "RESULT=0"
echo.
echo Upload completed. GitHub is building the website now.
echo Open: https://sixfeetas.github.io/life-os/
echo Wait 2-3 minutes after GitHub finishes the build.
goto finish

:login_error
set "RESULT=%errorlevel%"
echo.
echo GitHub login did not complete.
echo Close any sign-in page, then run this file again.
goto finish

:save_error
set "RESULT=%errorlevel%"
echo.
echo The local Git commit could not be created.
echo Close other Git or editor windows, then run this file again.
goto finish

:push_error
set "RESULT=%errorlevel%"
echo.
echo The upload failed. Check the messages above.

:finish
echo.
echo ==========================================
echo   Exit code: %RESULT%
echo ==========================================
echo.
pause





