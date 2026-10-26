@echo off
chcp 65001 >nul
cd /d "%~dp0"
set GCM_CREDENTIAL_STORE=dpapi
set GCM_GUI_PROMPT=true
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
echo Saving the newest files...
echo Step 1: Save the latest version locally.
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
echo Step 2: Upload to GitHub.
echo When Git asks for Username, type: sixfeetas
echo When Git asks for Password, paste your GitHub token.
echo Do not use your GitHub account password.
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 pull --rebase origin main
if errorlevel 1 echo Remote main is not ready yet. Continuing with the first upload.
git -c credential.helper= -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 -c http.sslBackend=openssl push -u origin main
if errorlevel 1 goto push_error
set "RESULT=0"
echo.
echo Upload completed. GitHub is building the website now.
echo Open: https://sixfeetas.github.io/life-os/
echo Wait 2-3 minutes after GitHub finishes the build.
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





