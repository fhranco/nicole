# F8.2 — Resultados de Pruebas de Concurrencia (14 Escenarios)

Ejecución real con conexiones paralelas (`Promise.all` sobre `psql` en `nicole_f8_staging`) usando datos ficticios (`Ficticio Uno`, `Ficticio Dos`).

| # | Escenario | Resultado | Evidencia observada |
|---|---|---|---|
| 1 | Dos pacientes reservan el mismo horario simultáneamente | **APROBADA** | `[true, false]` — segunda falla con `conflicting key value violates exclusion constraint "reservas_no_solapamiento_global"`. |
| 2 | Dos pacientes reservan horarios parcialmente superpuestos (`10:30` vs `10:00–11:00`) | **APROBADA** | Rechazada por `reservas_no_solapamiento_global`. |
| 3 | Dos consultas consecutivas sin superposición (`11:00` tras `10:00–11:00`) | **APROBADA** | Insertada con éxito (`812b951e-29a6-4c13-985c-afe92f929662`). |
| 4 | Dos bloques semanales incompatibles concurrentes | **APROBADA** | `[false, true]` — rechazada por `bloques_no_solapamiento_semanal`. |
| 5 | Disponibilidad puntual incompatible con otro bloque puntual | **APROBADA** | Rechazada por `bloques_no_solapamiento_fecha`. |
| 6 | Dos pagos simultáneos (`$50.000` + `$50.000`) superando saldo (`$80.000`) | **APROBADA** | `[true, false]` — segundo rechazado: `El monto (50000) supera el saldo pendiente (30000)`. |
| 7 | Dos solicitudes concurrentes con idéntica `idempotency_key` | **APROBADA** | Ambas `ok: true`; una `idempotent_replay: false`, la otra `idempotent_replay: true` con mismo `pago_id` (`nuevo_abono: 60000`). |
| 8 | Reutilización de `idempotency_key` con monto diferente (`15000` vs `10000`) | **APROBADA** | Rechazada: `ERROR: idempotency_key reutilizada con parámetros distintos`. |
| 9 | Webhook TUU duplicado concurrente | **APROBADA** | Una `idempotent_replay: false`, la otra `idempotent_replay: true` sin duplicar abono. |
| 10 | Pago posterior a expiración (cupo libre) | **APROBADA** | Reactiva la reserva a `{"ok": true, "estado": "abonada"}`. |
| 11 | Pago tardío con horario reasignado a otro paciente | **APROBADA** | No desecha el pago: retorna `{"ok": true, "motivo": "horario_ocupado", "requiere_conciliacion": true}`. |
| 12 | Fallo transaccional durante registro de pago | **APROBADA** | Rollback completo en Postgres sin insertar en `pagos_tuu` ni alterar `reservas`. |
| 13 | Confirmación simultánea de pago manual y electrónico TUU | **APROBADA** | Ambos serializados por `FOR UPDATE`: saldo final `20000|20000|abonada` sin pérdida de actualización. |
| 14 | Intento de sobrepago (`999999`) | **APROBADA** | Rechazado: `ERROR: El monto (999999) supera el saldo pendiente (20000)`. |
