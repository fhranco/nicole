# F8.4 — Reporte de Infraestructura y Migración en Staging

## Estado: **BLOQUEADO EN F8.4.1 (Falta proyecto Supabase Staging independiente)**

### Identificación de Instancias
- **Producción (PROHIBIDO TOCAR):** `https://bfzeejjzgvhfybtfeajg.supabase.co` (`pacientes`).
- **Staging:** No existe proyecto separado configurado todavía (`supabase projects list` devolvió `Invalid access token` y `.env.local` contiene únicamente credenciales de producción).

### Instrucciones para crear Staging sin costo (Plan Free de Supabase)
1. En tu panel de **Supabase**, crea un segundo proyecto gratuito llamado **`pacientes-staging`** (región `us-west-2`).
2. Copia su **Project URL**, **`anon public` key** y **`service_role` key** (nunca reutilices las de producción).
3. Compárteme esas 3 credenciales de **`pacientes-staging`** (o guárdalas en `.env.staging`) para ejecutar **F8.4.2, F8.4.3, F8.4.4 y F8.4.6** contra staging.

### Estado de F8.4.2 (Migración en Staging)
- Ejecución remota en staging: **NO VERIFICADA** (pendiente de creación de `pacientes-staging`).
- Asesores de seguridad de Supabase: **NO VERIFICADA** (pendiente de creación de `pacientes-staging`).
