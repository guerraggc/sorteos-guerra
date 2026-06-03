$ErrorActionPreference = "Stop"

$repo = "C:\Users\lydia\OneDrive\Documentos\pagina web"
$git = "C:\Program Files\Git\cmd\git.exe"

Set-Location $repo

Write-Host "Revisando cambios de Sorteos Guerra..."

& $git update-index --no-assume-unchanged --no-skip-worktree sorteos-g.json 2>$null
& $git update-index --really-refresh *> $null
& $git add -A -- .

$currentConfigHash = (& $git hash-object -w "sorteos-g.json").Trim()
$publishedConfigHash = (& $git rev-parse "HEAD:sorteos-g.json" 2>$null).Trim()

if ($currentConfigHash -and $currentConfigHash -ne $publishedConfigHash) {
  & $git update-index --add --cacheinfo "100644,$currentConfigHash,sorteos-g.json"
}

$changes = @(& $git diff --cached --name-only)

if (-not $changes.Count) {
  Write-Host "No hay cambios nuevos para subir."
  Write-Host "Si acabas de editar, guarda el archivo con Ctrl+S y vuelve a correr este boton."
  exit 0
}

Write-Host "Cambios detectados:"
$changes | ForEach-Object { Write-Host " - $_" }

& $git commit -m "Actualizar cambios de Sorteos Guerra"
if ($LASTEXITCODE -ne 0) {
  throw "No se pudo crear el commit."
}

& $git push
if ($LASTEXITCODE -ne 0) {
  throw "No se pudo subir a GitHub. Revisa tu internet o sesion de GitHub."
}

Write-Host "Listo. Render puede tardar unos minutos en mostrar los cambios."
