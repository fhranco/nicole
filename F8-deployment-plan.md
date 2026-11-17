# F8 — Plan de Respaldo, Entorno Aislado y Despliegue

## 1. Respaldo Completo y Recuperable (Previo a Migrar)
Un respaldo *data-only* **no es suficiente** porque no preserva restricciones `EXCLUDE`, triggers, funciones `SECURITY DEFINER`, políticas RLS ni permisos `GRANT`.
Antes de ejecutar `F8-migration.sql`, generar:
1. **Snapshot gestionado en Supabase:** *Database → Backups → Create manual backup* (si el plan lo habilita).
2. **Dump completo esquema + datos + roles/permisos** vía `pg_dump` (desde máquina segura con conexión directa Postgres):
   ```bash
   pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --file="backup_pre_f8_$(date +%Y%m%d_%H%M).dump"
   ```
   Para restaurar en emergencia:
   ```bash
   pg_restore --clean --if-exists --no-owner --dbname="$SUPABASE_DB_URL" backup_pre_f8_YYYYMMDD_HHMM.dump
   ```

## 2. Entorno Aislado de Pruebas
- Crear un **Supabase Branch** (o proyecto clon `pacientes-staging`) y restaurar allí el `.dump` o ejecutar `supabase-schema.sql` + `F8-migration.sql` + `F8-tests.sql`.
- Verificar que `F8-tests.sql` pase todas las aserciones (`23P01` en solapamientos, idempotencia de `registrar_pago_manual`, rechazo de sobrepagos y conciliación de pagos tardíos) antes de tocar producción.

## 3. Secuencia Controlada de Ejecución (Cuando se autorice)
1. **Preflight:** Ejecutar [F8-preflight.sql](file:///Volumes/SAMSUNG/Sitios%20Web/NICOLE-V2/F8-preflight.sql) en producción (solo lectura) y resolver cualquier solapamiento previo si existiera.
2. **Migración BD:** Ejecutar [F8-migration.sql](file:///Volumes/SAMSUNG/Sitios%20Web/NICOLE-V2/F8-migration.sql).
3. **Verificación post-migración:** Comparar conteos y sumas de `reservas` y `pagos_tuu` contra la línea base del Preflight.
4. **Actualización de consumidores:** Actualizar `api/tuu-webhook.js` para llamar a `confirmar_pago_tuu` y `admin.html` para llamar a `registrar_pago_manual` (con `crypto.randomUUID()` por intento).
5. **Rollback seguro:** En caso de incidente, ejecutar [F8-rollback.sql](file:///Volumes/SAMSUNG/Sitios%20Web/NICOLE-V2/F8-rollback.sql), el cual revierte triggers/constraints/políticas **sin eliminar ninguna columna ni fila financiera generada después de la migración**.
