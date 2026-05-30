# Sorteos Guerra - hosting

## Local

1. Instala Node.js si no lo tienes.
2. Abre `Iniciar Sorteos Guerra.bat` en el Escritorio.
3. Entra a `http://127.0.0.1:56684/index.html`.

## Admin

- Pagina: `admin.html`
- Clave inicial local: `guerra2026`
- En hosting cambia la clave con la variable de entorno `ADMIN_KEY`.

## Donde hostear

Recomendado para empezar gratis:

- Render: corre la pagina y el servidor Node.
- Supabase: guarda los compradores, boletos apartados y comprobantes.

Render sin Supabase puede servir para pruebas, pero el sistema de archivos del hosting puede perder
`data/db.json` y `uploads/` en reinicios o nuevos deploys. Para vender boletos reales, usa Supabase.

## Paso 1 - Crear Supabase

1. Entra a https://supabase.com y crea un proyecto gratis.
2. Abre **SQL Editor**.
3. Copia y ejecuta todo el archivo `supabase-schema.sql`.
4. Ve a **Project Settings > API** y copia:
   - Project URL
   - service_role key

Importante: la `service_role key` es privada. No la pegues en el codigo ni la publiques en GitHub.
Solo va como variable de entorno en Render.

## Paso 2 - Subir el proyecto a GitHub

Si no tienes Git instalado, usa la pagina de GitHub:

1. Crea un repositorio nuevo.
2. Sube todos los archivos de esta carpeta.
3. No subas `.env`, `data/db.json` ni archivos dentro de `uploads/`.

Ya existe `.gitignore` para evitar subir esos archivos si usas Git.

## Paso 3 - Crear Render Web Service

1. Entra a https://render.com.
2. Crea un **New Web Service**.
3. Conecta tu repositorio de GitHub.
4. Configura:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`

Variables de entorno en Render:

```txt
ADMIN_KEY=pon-una-clave-nueva
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
SUPABASE_BUCKET=receipts
```

## Paso 4 - Probar

Cuando Render termine, abre:

- `https://tu-app.onrender.com/index.html`
- `https://tu-app.onrender.com/admin.html`
- `https://tu-app.onrender.com/api/health`

Si `/api/health` dice `"storage":"supabase"`, ya esta guardando en Supabase.
Si dice `"storage":"local"`, falta poner las variables de Supabase en Render.

## Archivos importantes

- `server.js`: servidor de la pagina y API.
- `supabase-schema.sql`: base de datos y bucket de comprobantes.
- `render.yaml`: configuracion lista para Render.
- `.env.example`: ejemplo de variables.
- `.gitignore`: evita subir datos privados locales.
