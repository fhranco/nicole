# F8 — Arquitectura de Endurecimiento del Backend Clínico

## 1. Arquitectura de Reservas y Exclusión Temporal
- **Problema corregido (F8.0):** Una columna generada `GENERATED ALWAYS AS (tstzrange(fecha_hora, fecha_hora + make_interval(...))) STORED` falla en PostgreSQL porque la suma `timestamptz + interval` depende de la zona horaria de sesión (`STABLE`, no `IMMUTABLE`).
- **Solución:**
  - Almacenar explícitamente `fecha_inicio timestamptz` (sincronizada con `fecha_hora` por compatibilidad), `duracion_min integer` (copiada desde `servicios.duracion_min` al momento de crear la reserva para conservar la duración histórica), `fecha_fin timestamptz`, y `rango_horario tstzrange`.
  - Mantener `fecha_fin` y `rango_horario` mediante un **trigger `BEFORE INSERT OR UPDATE`** (`public.fn_reservas_sync_rango()`).
  - Aplicar restricción **`EXCLUDE USING gist (rango_horario WITH &&) WHERE (estado IN ('pendiente_pago', 'abonada', 'pagada', 'completada'))`**, garantizando que Nicole (única profesional) no pueda tener dos citas simultáneas en ninguna sede o modalidad.
- **Protección concurrente en `bloques_agenda`:**
  - Columna `rango_diario int4range` (minutos del día `[0, 1440)`) calculada por trigger + `EXCLUDE USING gist` separado para bloques semanales activos (`dia_semana WITH =, rango_diario WITH &&`) y fechas puntuales activas (`fecha_especifica WITH =, rango_diario WITH &&`).

## 2. Ciclo de Vida de Reservas `pendiente_pago` y Expiración (15 min)
1. **Pago exitoso dentro de los 15 min:** `confirmar_pago_tuu()` marca `pagos_tuu.tuu_status = 'paid'`, suma `monto_abonado_clp` y pasa `reservas.estado` a `abonada` o `pagada`.
2. **Abandono del checkout:** Tras `expira_pago_en < now()`, `expirar_reservas_pendientes()` cambia `estado` a `cancelada` (`motivo_cancelacion = 'expirada_sin_pago'`), liberando el horario para otro paciente.
3. **Pago recibido después de expiración (tardío):**
   - **Nunca se desecha el dinero recibido.**
   - `confirmar_pago_tuu()` registra `pagos_tuu.tuu_status = 'paid'` e intenta reactivar la reserva dentro de un bloque `BEGIN ... EXCEPTION WHEN exclusion_violation THEN ... END`.
   - Si el cupo sigue libre, la reactiva a `abonada`/`pagada`.
   - Si otro paciente ya tomó ese horario (`23P01`), deja la reserva en `cancelada` y marca `pagos_tuu.requiere_conciliacion = true` (`detalle_conciliacion = 'pago_tardio_horario_ocupado'`) para que Nicole reagende o reembolse manualmente.
4. **Fallo de comunicación con TUU:** La reserva queda `pendiente_pago` hasta que expire o se reintente el checkout; si el paciente pagó pero falló el webhook, Nicole concilia desde TUU Workspace.

## 3. Idempotencia y Atomicidad Financiera
- **`registrar_pago_manual(...)`:**
  - Verifica `public.es_admin_clinica()`.
  - Bloquea primero la fila de `reservas` con `SELECT ... FOR UPDATE`.
  - Consulta `idempotency_key` dentro de la misma transacción bloqueada: si existe, verifica que `reserva_id` y `monto_clp` coincidan exactamente (rechaza reutilización con parámetros distintos) y retorna `idempotent_replay = true`.
  - Valida `monto_clp > 0` y `monto_clp <= saldo_pendiente`, inserta en `pagos_tuu` (`origen_pago = 'manual'`) y actualiza `reservas` conservando estados clínicos (`completada` permanece `completada`).
- **`confirmar_pago_tuu(...)`:**
  - Ejecutable solo por `service_role` (desde `api/tuu-webhook.js`).
  - Verifica referencia, monto exacto y transición única `pending -> paid` bajo `FOR UPDATE`, inmune a eventos duplicados o fuera de orden.
