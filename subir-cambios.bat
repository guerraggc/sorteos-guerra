@echo off
cd /d "C:\Users\lydia\OneDrive\Documentos\pagina web"
echo Revisando cambios de Sorteos Guerra...
"C:\Program Files\Git\cmd\git.exe" update-index --really-refresh
"C:\Program Files\Git\cmd\git.exe" add -A
"C:\Program Files\Git\cmd\git.exe" diff --cached --quiet
if %errorlevel%==0 (
  echo No hay cambios nuevos para subir.
  pause
  exit /b 0
)
"C:\Program Files\Git\cmd\git.exe" commit -m "Actualizar cambios de Sorteos Guerra"
"C:\Program Files\Git\cmd\git.exe" push
echo Listo. Render puede tardar unos minutos en mostrar los cambios.
pause
