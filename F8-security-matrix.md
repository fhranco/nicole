# F8 — Matriz de Seguridad y Mínimo Privilegio

## 1. Autorización Administrativa Real
- **`public.administradores_clinica`:** Tabla privada (RLS habilitado, cero políticas para `anon` o `authenticated`; gestionada únicamente por `service_role`/SQL Editor) con `user_id` y `email` de Nicole.
- **`public.es_admin_clinica()`:** Función `SECURITY DEFINER` con `SET search_path = ''` que valida `EXISTS (SELECT 1 FROM public.administradores_clinica a WHERE a.user_id = auth.uid() AND a.activo = true)`.

## 2. Permisos por Tabla y Rol

| Tabla | `anon` | `authenticated` (Admin Nicole) | `service_role` (Backend Vercel) |
|---|---|---|---|
| `servicios` | `SELECT` (activos) | `SELECT` | `ALL` |
| `sedes` | `SELECT` (activas) | `SELECT` | `ALL` |
| `bloques_agenda` | `SELECT` (activos) | `ALL` solo si `es_admin_clinica()` | `ALL` |
| `pacientes` | Sin acceso | `SELECT, INSERT, UPDATE` si `es_admin_clinica()` | `ALL` |
| `reservas` | Sin acceso directo (solo RPCs seguras) | `SELECT, INSERT, UPDATE` si `es_admin_clinica()` *(sin `DELETE`)* | `ALL` |
| `pagos_tuu` | Sin acceso | **`SELECT` únicamente** si `es_admin_clinica()` *(escritura solo vía RPC)* | `ALL` |
| `fichas_ingreso_pacientes` | `INSERT` (con `intake_token` válido) | `SELECT` si `es_admin_clinica()` | `ALL` |
| `administradores_clinica` | Sin acceso | Sin acceso | `ALL` |

## 3. Permisos de Funciones RPC (`REVOKE ALL FROM PUBLIC, anon`)
- `validar_token_ingreso(uuid)`: `EXECUTE` para `anon, authenticated`.
- `horas_ocupadas_sede(date, text)`: `EXECUTE` para `anon, authenticated` (actualizada para excluir reservas `pendiente_pago` ya expiradas).
- `verificar_credito_previo(text, text, text)`: `EXECUTE` para `anon, authenticated`.
- `registrar_pago_manual(...)`: `EXECUTE` **exclusivo** para `authenticated` (validando `es_admin_clinica()`).
- `confirmar_pago_tuu(...)`: `EXECUTE` **exclusivo** para `service_role`.
- `expirar_reservas_pendientes()`: `EXECUTE` **exclusivo** para `service_role`.
