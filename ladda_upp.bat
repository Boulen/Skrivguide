@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Ladda upp Skrivguide till GitHub
set "LOG=%~dp0ladda_upp_logg.txt"
echo === Start %date% %time% === > "%LOG%"

echo [1/7] Kontrollerar att filerna finns...
if not exist "index.html" (
  echo FEL: index.html finns inte i den har mappen. Packa upp zip-filen forst och kor filen fran den uppackade mappen.
  goto :fel
)

echo [2/7] Kontrollerar att Git ar installerat...
git --version >> "%LOG%" 2>&1
if errorlevel 1 (
  echo FEL: Git hittas inte. Installera Git for Windows fran https://git-scm.com/download/win
  echo      Stang sedan det har fonstret och oppna filen igen.
  goto :fel
)

echo [3/7] Kopplar mappen till GitHub...
if not exist ".git" (
  git init >> "%LOG%" 2>&1
  if errorlevel 1 goto :fel
)
git config core.autocrlf false
git checkout -B main >> "%LOG%" 2>&1

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo Skapa forst ett TOMT repo pa github.com om du inte redan gjort det.
  echo Klistra in adressen, t.ex. https://github.com/Boulen/Skrivguide.git
  set "URL="
  set /p "URL=Repo-adress: "
  if not defined URL (
    echo FEL: Ingen adress angavs.
    goto :fel
  )
  git remote add origin "%URL%" >> "%LOG%" 2>&1
  if errorlevel 1 goto :fel
)
for /f "delims=" %%i in ('git remote get-url origin') do echo Repo: %%i

echo [4/7] Kontrollerar namn och e-post for historiken...
set "GNAME="
for /f "delims=" %%i in ('git config user.name 2^>nul') do set "GNAME=%%i"
if not defined GNAME (
  set /p "GNAME=Ditt namn: "
  git config user.name "%GNAME%"
)
set "GMAIL="
for /f "delims=" %%i in ('git config user.email 2^>nul') do set "GMAIL=%%i"
if not defined GMAIL (
  set /p "GMAIL=Din e-postadress: "
  git config user.email "%GMAIL%"
)

echo [5/7] Samlar ihop andringar...
git add -A >> "%LOG%" 2>&1
if errorlevel 1 goto :fel
git diff --cached --quiet
if not errorlevel 1 (
  echo Inget nytt att spara. Hoppar over commit.
  goto :push
)
set "MSG="
set /p "MSG=Beskriv andringen (Enter = Uppdatering): "
if not defined MSG set "MSG=Uppdatering"
git commit -m "%MSG%" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo FEL vid commit.
  goto :fel
)

:push
echo [6/7] Laddar upp till GitHub. Ett inloggningsfonster kan oppnas, logga in dar...
git push -u origin main
if errorlevel 1 (
  echo.
  echo Uppladdningen avvisades. Forsoker hamta det som redan finns pa GitHub och sla ihop...
  git pull origin main --rebase --allow-unrelated-histories >> "%LOG%" 2>&1
  if errorlevel 1 (
    git rebase --abort >nul 2>&1
    echo FEL: Det gick inte att sla ihop automatiskt.
    goto :fel
  )
  echo [7/7] Forsoker ladda upp igen...
  git push -u origin main
  if errorlevel 1 goto :fel
)

echo.
echo ===== KLART! =====
echo Sidan uppdateras pa GitHub Pages om ungefar en minut. Tryck Ctrl+Shift+R i webblasaren.
echo === Klart === >> "%LOG%"
pause
exit /b 0

:fel
echo.
echo ===== NAGOT GICK FEL =====
echo Lasa raderna ovanfor. Detaljer finns i filen ladda_upp_logg.txt i samma mapp.
echo Skicka en skarmbild av det har fonstret, eller innehallet i loggfilen, till huvud-chatten.
echo.
echo Senaste raderna i loggen:
powershell -NoProfile -Command "Get-Content -Tail 15 -LiteralPath '%LOG%'" 2>nul
pause
exit /b 1
