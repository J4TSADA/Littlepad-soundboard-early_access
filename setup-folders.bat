@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Mini Soundpad - folder setup
echo   working in: %CD%
echo ============================================
echo.

if not exist "package.json" (
  echo [X] package.json NOT FOUND here.
  echo     Put this .bat inside the ai_here_to folder and run again.
  pause
  exit /b 1
)

echo [1/4] creating folders...
if not exist "src\main"     mkdir "src\main"
if not exist "src\preload"  mkdir "src\preload"
if not exist "src\renderer" mkdir "src\renderer"
if not exist "src\shared"   mkdir "src\shared"
if not exist "scripts"      mkdir "scripts"
echo      done.
echo.

echo [2/4] moving loose files into place...
call :grab "types.ts"          "src\shared"
call :grab "store.ts"          "src\main"
call :grab "audio.ts"          "src\renderer"
call :grab "hotkey.ts"         "src\renderer"
call :grab "index.html"        "src\renderer"
call :grab "styles.css"        "src\renderer"
call :grab "copy-static.mjs"   "scripts"

rem index.ts is ambiguous - detect it by its first import line
if exist "index.ts" (
  findstr /c:"AudioEngine" "index.ts" >nul 2>&1
  if !errorlevel!==0 (
    move /y "index.ts" "src\renderer\" >nul
    echo      index.ts        -^> src\renderer\   [renderer detected]
  ) else (
    findstr /c:"contextBridge" "index.ts" >nul 2>&1
    if !errorlevel!==0 (
      move /y "index.ts" "src\preload\" >nul
      echo      index.ts        -^> src\preload\    [preload detected]
    ) else (
      move /y "index.ts" "src\main\" >nul
      echo      index.ts        -^> src\main\       [main detected]
    )
  )
)
echo.

echo [3/4] recovering files from mnt folder...
set "MNT=mnt\user-data\outputs\mini-soundpad\src"
if exist "%MNT%\main\index.ts" (
  copy /y "%MNT%\main\index.ts" "src\main\index.ts" >nul
  echo      main\index.ts     recovered
)
if exist "%MNT%\preload\index.ts" (
  copy /y "%MNT%\preload\index.ts" "src\preload\index.ts" >nul
  echo      preload\index.ts  recovered
)
if exist "%MNT%\renderer\index.ts" (
  copy /y "%MNT%\renderer\index.ts" "src\renderer\index.ts" >nul
  echo      renderer\index.ts recovered
)
echo.

echo [4/4] writing src\renderer\global.d.ts ...
(
echo import type { SoundpadApi } from '../preload/index';
echo.
echo declare global {
echo   interface Window {
echo     api: SoundpadApi;
echo   }
echo }
echo.
echo export {};
) > "src\renderer\global.d.ts"
echo      done.
echo.

echo ============================================
echo   CHECKLIST - all 10 must say OK
echo ============================================
call :check "src\shared\types.ts"
call :check "src\main\store.ts"
call :check "src\main\index.ts"
call :check "src\preload\index.ts"
call :check "src\renderer\audio.ts"
call :check "src\renderer\hotkey.ts"
call :check "src\renderer\index.ts"
call :check "src\renderer\global.d.ts"
call :check "src\renderer\index.html"
call :check "src\renderer\styles.css"
call :check "scripts\copy-static.mjs"
echo ============================================
echo.
echo Next:  npm run typecheck
echo Then:  npm start
echo.
pause
exit /b 0

:grab
if exist %1 (
  move /y %1 %2\ >nul
  echo      %~1 -^> %~2\
)
exit /b 0

:check
if exist %1 (echo   [OK]      %~1) else (echo   [MISSING] %~1)
exit /b 0
