# F8.2 — Resultados de Migración Experimental y Validación Funcional

**Entorno aislado:** PostgreSQL `16.15` local (`nicole_f8_staging`, puerto `5432`) con shim de `auth.users`, `auth.uid()` y `storage.objects`.  
**Instancia de producción:** Intacta (cero cambios remotos).

| Prueba | Resultado | Evidencia |
|---|---|---|
| Ejecución de `supabase-schema.sql` + `F8-preflight.sql` + `F8-migration.sql` | **APROBADA** | `exit 0`, `btree_gist 1.7` instalado, `COMMIT` limpio. |
| Triggers `trg_reservas_sync_rango` y `trg_bloques_sync_rango` | **APROBADA** | Calculan `fecha_fin`, `rango_horario` (`tstzrange`) y `rango_diario` (`int4range`). |
| Duración histórica en `reservas` | **APROBADA** | `duracion_min` copiada desde `servicios` al insertar. |
| Exclusión temporal global (`reservas_no_solapamiento_global`) | **APROBADA** | Bloquea reservas solapadas entre distintas sedes/modalidades (`23P01`). |
| Expiración `expirar_reservas_pendientes()` | **APROBADA** | Marca `pendiente_pago` vencidas como `cancelada` (`expirada_sin_pago`). |
| Integración real con Vercel / TUU HTTP Checkout | **NO VERIFICADA** | Restringida por alcance de F8.2 (no procesar pagos reales ni desplegar). |
