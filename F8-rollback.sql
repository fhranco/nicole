-- =========================================================================
-- F8-ROLLBACK.SQL — REVERSIÓN SEGURA SIN ELIMINAR DATOS FINANCIEROS
-- CONSERVA TODAS LAS FILAS DE pagos_tuu Y reservas GENERADAS POST-MIGRACIÓN
-- =========================================================================

begin;

-- 1. Restaurar políticas RLS previas
drop policy if exists "Solo admin clinica gestiona bloques" on public.bloques_agenda;
create policy "Solo equipo autenticado gestiona bloques"
  on public.bloques_agenda for all to authenticated using (true) with check (true);

drop policy if exists "Solo admin clinica gestiona pacientes" on public.pacientes;
create policy "Solo equipo autenticado gestiona pacientes"
  on public.pacientes for all to authenticated using (true) with check (true);

drop policy if exists "Solo admin clinica lee reservas" on public.reservas;
drop policy if exists "Solo admin clinica crea reservas" on public.reservas;
drop policy if exists "Solo admin clinica actualiza reservas" on public.reservas;
create policy "Solo equipo autenticado gestiona reservas"
  on public.reservas for all to authenticated using (true) with check (true);

drop policy if exists "Solo admin clinica lee pagos" on public.pagos_tuu;
create policy "Solo equipo autenticado ve pagos TUU"
  on public.pagos_tuu for all to authenticated using (true) with check (true);

drop policy if exists "Solo admin clinica lee fichas" on public.fichas_ingreso_pacientes;
create policy "Solo equipo autenticado lee fichas"
  on public.fichas_ingreso_pacientes for select to authenticated using (true);

-- 2. Remover restricciones GiST y triggers (sin borrar filas de datos)
alter table public.reservas drop constraint if exists reservas_no_solapamiento_global;
drop trigger if exists trg_reservas_sync_rango on public.reservas;
drop function if exists public.fn_reservas_sync_rango();

alter table public.bloques_agenda drop constraint if exists bloques_no_solapamiento_semanal;
alter table public.bloques_agenda drop constraint if exists bloques_no_solapamiento_fecha;
drop trigger if exists trg_bloques_sync_rango on public.bloques_agenda;
drop function if exists public.fn_bloques_sync_rango();

-- 3. Remover funciones RPC nuevas
drop function if exists public.confirmar_pago_tuu(text, integer, text, jsonb);
drop function if exists public.registrar_pago_manual(uuid, integer, text, text, text);
drop function if exists public.expirar_reservas_pendientes();
drop function if exists public.es_admin_clinica();

-- Nota: Las columnas nuevas (origen_pago, idempotency_key, requiere_conciliacion,
-- fecha_inicio, fecha_fin, duracion_min) se conservan intactas para NO perder
-- trazabilidad financiera ni histórica generada después de la migración.

commit;
