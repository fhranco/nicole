# F8.4 — Validación de PostgREST y Consumidores

**Estado general:** **NO VERIFICADA** para HTTP/PostgREST remoto (pendiente de `pacientes-staging`).

| Componente | Resultado | Observación |
|---|---|---|
| `admin.html` contra PostgREST `/rest/v1/rpc/registrar_pago_manual` | **NO VERIFICADA** | Sintaxis aprobada; falta prueba HTTP contra staging. |
| `reservar.html` contra PostgREST `/rest/v1/rpc/horas_ocupadas_sede` | **NO VERIFICADA** | Sintaxis aprobada; falta prueba HTTP contra staging. |
| `api/tuu-crear-pago.js` y `api/tuu-webhook.js` extremo a extremo | **NO VERIFICADA** | Pendiente de credenciales staging en `.env.staging`. |
