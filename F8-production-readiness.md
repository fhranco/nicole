# F8.2 — Evaluación de Preparación para Producción (Production Readiness)

## Estado General: **LISTO PARA FASE F8.3 (AUTORIZACIÓN DE PRODUCCIÓN)**

- **14/14** escenarios de concurrencia **APROBADOS** en PostgreSQL `16.15` aislado.
- **6/6** pruebas de seguridad por perfil (`anon`, `authenticated` no-admin, `Nicole admin`, `service_role`) **APROBADAS**.
- **Rollback sin pérdida de datos financieros** y **restauración completa `pg_dump`/`pg_restore`** **APROBADOS**.

### Hallazgo importante detectado durante las pruebas (para ejecutar en producción)
1. **Permisos base para `authenticated`:** En Postgres limpio, `authenticated` requiere `GRANT SELECT` explícito sobre `reservas`, `pagos_tuu`, `fichas_ingreso_pacientes`, `bloques_agenda`, `pacientes` para que las políticas RLS operen como filtro (ya que `Supabase` suele otorgarlos por defecto, conviene incluirlos explícitamente en el paso de despliegue).
2. **Actualización pendiente de consumidores (solo tras autorizar F8.3):**
   - `api/tuu-webhook.js` debe invocar `confirmar_pago_tuu(...)` en vez de hacer `PATCH` directo.
   - `admin.html` debe invocar `registrar_pago_manual(...)` vía `/rest/v1/rpc/registrar_pago_manual` con `crypto.randomUUID()` como `idempotency_key`.
   - Configurar un cron (ej. `pg_cron` o cada llamada en `api/tuu-crear-pago.js`) que ejecute `expirar_reservas_pendientes()` periódicamente.

**No se ha modificado la instancia de producción ni `admin.html`. Esperando nueva autorización explícita para F8.3.**
