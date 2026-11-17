# F8.4 — Validación de Autenticación y Autorización Reales (Supabase Auth / JWT)

**Estado general:** **NO VERIFICADA** (bloqueado en F8.4.1 por falta de instancia Supabase Staging independiente).

| Comprobación | Resultado | Motivo |
|---|---|---|
| Inicio y cierre de sesión vía `/auth/v1/token` real | **NO VERIFICADA** | Requiere URL y `anon key` de `pacientes-staging`. |
| Validación de JWT real y expiración de sesión | **NO VERIFICADA** | Requiere instancia Supabase Staging. |
| Acceso autorizado a RPC (`es_admin_clinica`, `registrar_pago_manual`) vía JWT | **NO VERIFICADA** | Requiere PostgREST + GoTrue de staging (en PostgreSQL local se aprobó en F8.2). |
| Bloqueo de escalado de privilegios y protección de fichas/pagos vía HTTP | **NO VERIFICADA** | Pendiente de ejecución HTTP contra `pacientes-staging`. |
