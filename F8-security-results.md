# F8.2 — Resultados de Pruebas de Seguridad (4 Perfiles)

| ID | Perfil simulado | Operación probada | Resultado | Evidencia |
|---|---|---|---|---|
| SEC01 | Visitante anónimo (`anon`) | `SELECT count(*) FROM public.reservas` | **APROBADA** | Denegado (`permission denied for table reservas`). |
| SEC02 | Usuario autenticado sin rol admin | `SELECT count(*) FROM public.reservas` (con `GRANT SELECT` activo) | **APROBADA** | Retorna `0` filas gracias a `es_admin_clinica()`. |
| SEC03 | Usuario autenticado sin rol admin | `registrar_pago_manual(...)` | **APROBADA** | Denegado: `ERROR: No autorizado: se requiere rol administrador clínico`. |
| SEC04 | Administradora clínica (`Nicole`) | `INSERT INTO public.pagos_tuu` directo (bypass de RPC) | **APROBADA** | Denegado (`permission denied for table pagos_tuu`). |
| SEC05 | Usuario autenticado sin rol admin | `INSERT INTO public.administradores_clinica` (auto-escalado) | **APROBADA** | Denegado (`permission denied for table administradores_clinica`). |
| SEC06 | Servicio backend (`service_role`) | `confirmar_pago_tuu(...)` | **APROBADA** | Ejecución autorizada y atómica (`T09`, `T10`, `T11`, `T13`). |
