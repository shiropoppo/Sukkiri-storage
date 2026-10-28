@echo off
rem ============================================================
rem  すっきり容量整理 を起動します。
rem  画面（ブラウザ）が開いたら、このウィンドウは自動で閉じます。
rem ============================================================
if not exist "%~dp0server\server.ps1" (
  echo.
  echo   ZIP ファイルの中からは起動できません。
  echo   ZIP ファイルを右クリックして「すべて展開」を選び、
  echo   展開したフォルダの中の「はじめる」をダブルクリックしてください。
  echo.
  pause
  exit /b 1
)
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server\server.ps1"
exit /b 0
