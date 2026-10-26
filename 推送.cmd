@echo off
chcp 65001 >nul
cd /d "%~dp0"
set GCM_CREDENTIAL_STORE=dpapi
set GCM_GUI_PROMPT=true
set GCM_INTERACTIVE=always
set "HTTP_PROXY=http://127.0.0.1:7890"
set "HTTPS_PROXY=http://127.0.0.1:7890"
set GIT_TERMINAL_PROMPT=1
echo ==========================================
echo   Life OS - upload to GitHub
echo ==========================================
echo.
echo Repo: https://github.com/sixfeetas/life-os
echo Site: https://sixfeetas.github.io/life-os/
echo.
echo Step 1: Sign in to GitHub in the browser window.
git credential-manager github login --browser
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
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 -c http.sslBackend=openssl pull --rebase origin main
if errorlevel 1 echo Remote main is not ready yet. Continuing with the first upload.
git -c credential.helper=manager -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 -c http.sslBackend=openssl push -u origin main
if errorlevel 1 goto push_error
set "RESULT=0"
echo.
echo Upload completed. GitHub is building the website now.
echo Open: https://sixfeetas.github.io/life-os/
echo Wait 2-3 minutes after GitHub finishes the build.
start "" "https://github.com/sixfeetas/life-os/settings/pages"
goto finish

:login_error
set "RESULT=1"
echo.
echo GitHub login did not complete.
echo Finish the login in the browser, then run this file again.
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





