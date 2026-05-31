@echo off
setlocal
cd /d "C:\Users\lydia\OneDrive\Documentos\pagina web"
set "GIT=C:\Program Files\Git\cmd\git.exe"
set "CHANGES=%TEMP%\sorteos-g-cambios.txt"

echo Revisando cambios de Sorteos Guerra...

"%GIT%" update-index --no-assume-unchanged --no-skip-worktree sorteos-g.json 2>nul
"%GIT%" update-index --really-refresh >nul 2>nul
"%GIT%" add -A -- .

"%GIT%" diff --cached --name-only > "%CHANGES%"
for %%A in ("%CHANGES%") do if %%~zA==0 (
  echo No hay cambios nuevos para subir.
  del "%CHANGES%" >nul 2>nul
  pause
  exit /b 0
)

echo Cambios detectados:
type "%CHANGES%"
del "%CHANGES%" >nul 2>nul

"%GIT%" commit -m "Actualizar cambios de Sorteos Guerra"
if errorlevel 1 (
  echo No se pudo crear el commit. Revisa el mensaje de arriba.
  pause
  exit /b 1
)

"%GIT%" push
if errorlevel 1 (
  echo No se pudo subir a GitHub. Revisa tu internet o sesion de GitHub.
  pause
  exit /b 1
)

echo Listo. Render puede tardar unos minutos en mostrar los cambios.
pause
