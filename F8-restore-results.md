# F8.2 — Resultados de Respaldo, Rollback y Restauración

1. **Respaldo completo (`pg_dump --format=custom --no-owner`):**
   - Generado sobre `nicole_f8_staging` con esquema, extensiones, triggers, funciones, políticas RLS y datos. **APROBADA**.
2. **Ejecución de `F8-rollback.sql` y conservación financiera:**
   - Rollback ejecutado con `exit 0` (`COMMIT`).
   - Verificación post-rollback en `pagos_tuu`: **`7` registros `paid` sumando `$110.000 CLP` conservados al 100%**. **APROBADA**.
3. **Restauración en base limpia (`nicole_f8_restore` via `pg_restore`):**
   - `reservas` restauradas: **`8` filas**.
   - `pagos_tuu` (`paid`) restauradas: **`7` filas**.
   - Restricción GiST `reservas_no_solapamiento_global`: **`1` (restaurada intacta)**. **APROBADA**.
4. **Dependencias externas no incluidas en el dump SQL:**
   - Usuarios/contraseñas administrados por Supabase Auth (`auth.users` en producción), variables de entorno de Vercel (`.env` / `TUU_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) y archivos físicos en Storage (`examenes-pacientes`).
