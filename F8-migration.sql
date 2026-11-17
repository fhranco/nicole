-- =========================================================================
-- F8-MIGRATION.SQL — ENDURECIMIENTO TRANSACCIONAL Y SEGURIDAD
-- PROPUESTA PARA REVISIÓN (NO EJECUTAR SIN RESPALDO Y AUTORIZACIÓN)
-- =========================================================================

begin;

create extension if not exists btree_gist;

-- -------------------------------------------------------------------------
-- 1. ADMINISTRADORES CLÍNICOS (Reemplaza auth.uid() IS NOT NULL genérico)
-- -------------------------------------------------------------------------
create table if not exists public.administradores_clinica (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.administradores_clinica enable row level security;
revoke all on table public.administradores_clinica from public, anon, authenticated;

-- Registra automáticamente al usuario de Nicole si ya existe en auth.users
insert into public.administradores_clinica (user_id, email, activo)
select id, email, true
from auth.users
where lower(email) in ('consulta@nicoleborguenson.cl', 'nborguensonf@gmail.com')
on conflict (user_id) do update set activo = true;

create or replace function public.es_admin_clinica()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.administradores_clinica a
    where a.user_id = auth.uid()
      and a.activo = true
  );
$$;

revoke all on function public.es_admin_clinica() from public, anon;
grant execute on function public.es_admin_clinica() to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 2. RESERVAS: FECHA INICIO/FIN EXPLÍCITAS, DURACIÓN HISTÓRICA Y GiST
-- -------------------------------------------------------------------------
alter table public.reservas
  add column if not exists fecha_inicio timestamptz,
  add column if not exists fecha_fin timestamptz,
  add column if not exists duracion_min integer,
  add column if not exists rango_horario tstzrange,
  add column if not exists expira_pago_en timestamptz,
  add column if not exists motivo_cancelacion text;

-- Backfill seguro sobre registros existentes
update public.reservas r
set
  fecha_inicio = coalesce(r.fecha_inicio, r.fecha_hora),
  duracion_min = coalesce(r.duracion_min, s.duracion_min, 60),
  fecha_fin = coalesce(r.fecha_fin, r.fecha_hora + make_interval(mins => coalesce(r.duracion_min, s.duracion_min, 60))),
  rango_horario = tstzrange(
    coalesce(r.fecha_inicio, r.fecha_hora),
    coalesce(r.fecha_fin, r.fecha_hora + make_interval(mins => coalesce(r.duracion_min, s.duracion_min, 60))),
    '[)'
  ),
  expira_pago_en = case
    when r.estado = 'pendiente_pago' and r.expira_pago_en is null then r.created_at + interval '15 minutes'
    else r.expira_pago_en
  end
from public.servicios s
where s.slug = r.servicio_slug;

alter table public.reservas
  alter column fecha_inicio set not null,
  alter column fecha_fin set not null,
  alter column duracion_min set not null,
  alter column rango_horario set not null;

create or replace function public.fn_reservas_sync_rango()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dur integer;
begin
  new.fecha_inicio := coalesce(new.fecha_inicio, new.fecha_hora);
  new.fecha_hora := new.fecha_inicio;

  if tg_op = 'INSERT' and new.duracion_min is null then
    select s.duracion_min into v_dur
    from public.servicios s
    where s.slug = new.servicio_slug;
    new.duracion_min := coalesce(v_dur, 60);
  elsif new.duracion_min is null then
    new.duracion_min := 60;
  end if;

  if new.duracion_min <= 0 then
    raise exception 'La duración de la reserva debe ser mayor a 0 minutos';
  end if;

  new.fecha_fin := new.fecha_inicio + make_interval(mins => new.duracion_min);
  new.rango_horario := tstzrange(new.fecha_inicio, new.fecha_fin, '[)');

  if tg_op = 'INSERT' and new.estado = 'pendiente_pago' and new.expira_pago_en is null then
    new.expira_pago_en := now() + interval '15 minutes';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reservas_sync_rango on public.reservas;
create trigger trg_reservas_sync_rango
  before insert or update of fecha_hora, fecha_inicio, duracion_min, servicio_slug
  on public.reservas
  for each row
  execute function public.fn_reservas_sync_rango();

alter table public.reservas drop constraint if exists reservas_no_solapamiento_global;
alter table public.reservas
  add constraint reservas_no_solapamiento_global
  exclude using gist (rango_horario with &&)
  where (estado in ('pendiente_pago', 'abonada', 'pagada', 'completada'));

-- -------------------------------------------------------------------------
-- 3. BLOQUES_AGENDA: PROTECCIÓN CONCURRENTE MEDIANTE RANGO DIARIO GiST
-- -------------------------------------------------------------------------
alter table public.bloques_agenda
  add column if not exists rango_diario int4range;

update public.bloques_agenda
set rango_diario = int4range(
  extract(hour from hora_inicio)::int * 60 + extract(minute from hora_inicio)::int,
  extract(hour from hora_fin)::int * 60 + extract(minute from hora_fin)::int,
  '[)'
)
where rango_diario is null;

create or replace function public.fn_bloques_sync_rango()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ini integer;
  v_fin integer;
begin
  v_ini := extract(hour from new.hora_inicio)::int * 60 + extract(minute from new.hora_inicio)::int;
  v_fin := extract(hour from new.hora_fin)::int * 60 + extract(minute from new.hora_fin)::int;
  if v_fin <= v_ini then
    raise exception 'hora_fin debe ser mayor a hora_inicio';
  end if;
  new.rango_diario := int4range(v_ini, v_fin, '[)');
  return new;
end;
$$;

drop trigger if exists trg_bloques_sync_rango on public.bloques_agenda;
create trigger trg_bloques_sync_rango
  before insert or update of hora_inicio, hora_fin
  on public.bloques_agenda
  for each row
  execute function public.fn_bloques_sync_rango();

alter table public.bloques_agenda drop constraint if exists bloques_no_solapamiento_semanal;
alter table public.bloques_agenda
  add constraint bloques_no_solapamiento_semanal
  exclude using gist (dia_semana with =, rango_diario with &&)
  where (activo = true and fecha_especifica is null);

alter table public.bloques_agenda drop constraint if exists bloques_no_solapamiento_fecha;
alter table public.bloques_agenda
  add constraint bloques_no_solapamiento_fecha
  exclude using gist (fecha_especifica with =, rango_diario with &&)
  where (activo = true and fecha_especifica is not null);

-- -------------------------------------------------------------------------
-- 4. EXPIRACIÓN DE RESERVAS PENDIENTES Y ACTUALIZACIÓN DE DISPONIBILIDAD
-- -------------------------------------------------------------------------
create or replace function public.expirar_reservas_pendientes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.reservas
  set estado = 'cancelada',
      motivo_cancelacion = 'expirada_sin_pago',
      notas = coalesce(notas || ' | ', '') || 'Expirada automáticamente tras 15 min sin pago'
  where estado = 'pendiente_pago'
    and expira_pago_en is not null
    and expira_pago_en < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expirar_reservas_pendientes() from public, anon, authenticated;
grant execute on function public.expirar_reservas_pendientes() to service_role;

create or replace function public.horas_ocupadas_sede(p_fecha date, p_sede text default null)
returns table (fecha_hora timestamptz)
language sql
security definer
set search_path = ''
as $$
  select r.fecha_inicio as fecha_hora
  from public.reservas r
  where r.fecha_inicio::date = p_fecha
    and (
      r.estado in ('abonada', 'pagada', 'completada')
      or (r.estado = 'pendiente_pago' and (r.expira_pago_en is null or r.expira_pago_en >= now()))
    )
    and (p_sede is null or r.sede_slug = p_sede);
$$;

revoke all on function public.horas_ocupadas_sede(date, text) from public;
grant execute on function public.horas_ocupadas_sede(date, text) to anon, authenticated, service_role;

-- -------------------------------------------------------------------------
-- 5. INTEGRIDAD FINANCIERA: PAGOS MANUALES + WEBHOOK TUU IDEMPOTENTE
-- -------------------------------------------------------------------------
alter table public.pagos_tuu
  add column if not exists origen_pago text not null default 'tuu' check (origen_pago in ('tuu', 'manual')),
  add column if not exists idempotency_key text unique,
  add column if not exists registrado_por uuid references auth.users(id),
  add column if not exists requiere_conciliacion boolean not null default false,
  add column if not exists detalle_conciliacion text;

create or replace function public.registrar_pago_manual(
  p_reserva_id uuid,
  p_monto_clp integer,
  p_medio text,
  p_concepto text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rsv public.reservas%rowtype;
  v_pago public.pagos_tuu%rowtype;
  v_saldo integer;
  v_nuevo_abono integer;
  v_nuevo_estado text;
begin
  if not public.es_admin_clinica() then
    raise exception 'No autorizado: se requiere rol administrador clínico';
  end if;

  if p_monto_clp is null or p_monto_clp <= 0 then
    raise exception 'El monto debe ser un entero positivo en CLP';
  end if;

  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'idempotency_key obligatorio';
  end if;

  -- Bloquear reserva primero para serializar operaciones concurrentes
  select * into v_rsv
  from public.reservas
  where id = p_reserva_id
  for update;

  if not found then
    raise exception 'Reserva no encontrada';
  end if;

  -- Verificar idempotencia dentro de la transacción bloqueada
  select * into v_pago
  from public.pagos_tuu
  where idempotency_key = p_idempotency_key;

  if found then
    if v_pago.reserva_id <> p_reserva_id or v_pago.monto_clp <> p_monto_clp then
      raise exception 'idempotency_key reutilizada con parámetros distintos';
    end if;
    return jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'pago_id', v_pago.id,
      'nuevo_abono', v_rsv.monto_abonado_clp,
      'nuevo_saldo', greatest(v_rsv.precio_total_clp - v_rsv.credito_previo_clp - v_rsv.monto_abonado_clp, 0),
      'estado', v_rsv.estado
    );
  end if;

  if v_rsv.estado = 'cancelada' then
    raise exception 'No se puede registrar pago sobre una reserva cancelada';
  end if;

  v_saldo := greatest(v_rsv.precio_total_clp - v_rsv.credito_previo_clp - v_rsv.monto_abonado_clp, 0);
  if p_monto_clp > v_saldo then
    raise exception 'El monto (%) supera el saldo pendiente (%)', p_monto_clp, v_saldo;
  end if;

  v_nuevo_abono := v_rsv.monto_abonado_clp + p_monto_clp;
  -- Conservar estado clínico 'completada' si la sesión ya ocurrió
  v_nuevo_estado := case
    when v_rsv.estado = 'completada' then 'completada'
    when (v_rsv.credito_previo_clp + v_nuevo_abono) >= v_rsv.precio_total_clp then 'pagada'
    else 'abonada'
  end;

  insert into public.pagos_tuu (
    reserva_id, paciente_id, concepto, monto_clp,
    tuu_transaction_id, tuu_status, origen_pago, idempotency_key, registrado_por
  ) values (
    v_rsv.id, v_rsv.paciente_id,
    coalesce(nullif(trim(p_concepto), ''), 'Pago manual') || ' (' || coalesce(nullif(trim(p_medio), ''), 'Manual') || ')',
    p_monto_clp,
    'manual-' || p_idempotency_key,
    'paid',
    'manual',
    p_idempotency_key,
    v_uid
  )
  returning * into v_pago;

  update public.reservas
  set monto_abonado_clp = v_nuevo_abono,
      estado = v_nuevo_estado
  where id = v_rsv.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'pago_id', v_pago.id,
    'nuevo_abono', v_nuevo_abono,
    'nuevo_saldo', greatest(v_rsv.precio_total_clp - v_rsv.credito_previo_clp - v_nuevo_abono, 0),
    'estado', v_nuevo_estado
  );
end;
$$;

revoke all on function public.registrar_pago_manual(uuid, integer, text, text, text) from public, anon;
grant execute on function public.registrar_pago_manual(uuid, integer, text, text, text) to authenticated;

-- RPC transaccional para Webhook TUU (incluye pagos duplicados y pagos tardíos)
create or replace function public.confirmar_pago_tuu(
  p_reference text,
  p_monto_clp integer,
  p_tuu_status text,
  p_raw_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pago public.pagos_tuu%rowtype;
  v_rsv public.reservas%rowtype;
  v_nuevo_abono integer;
  v_nuevo_estado text;
begin
  select * into v_pago
  from public.pagos_tuu
  where tuu_transaction_id = p_reference
  for update;

  if not found then
    raise exception 'Transacción TUU no encontrada: %', p_reference;
  end if;

  if v_pago.tuu_status = 'paid' then
    return jsonb_build_object('ok', true, 'idempotent_replay', true, 'reserva_id', v_pago.reserva_id);
  end if;

  if lower(coalesce(p_tuu_status, '')) not in ('completed', 'paid', 'approved') then
    update public.pagos_tuu
    set tuu_status = 'failed',
        tuu_raw_payload = coalesce(p_raw_payload, '{}'::jsonb)
    where id = v_pago.id;
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;

  if p_monto_clp is null or p_monto_clp <> v_pago.monto_clp then
    update public.pagos_tuu
    set tuu_status = 'paid',
        requiere_conciliacion = true,
        detalle_conciliacion = format('Monto recibido (%s) difiere del esperado (%s)', p_monto_clp, v_pago.monto_clp),
        tuu_raw_payload = coalesce(p_raw_payload, '{}'::jsonb)
    where id = v_pago.id;
    return jsonb_build_object('ok', false, 'requiere_conciliacion', true, 'motivo', 'monto_distinto');
  end if;

  select * into v_rsv
  from public.reservas
  where id = v_pago.reserva_id
  for update;

  v_nuevo_abono := v_rsv.monto_abonado_clp + v_pago.monto_clp;
  v_nuevo_estado := case
    when v_rsv.estado = 'completada' then 'completada'
    when (v_rsv.credito_previo_clp + v_nuevo_abono) >= v_rsv.precio_total_clp then 'pagada'
    else 'abonada'
  end;

  update public.pagos_tuu
  set tuu_status = 'paid',
      tuu_raw_payload = coalesce(p_raw_payload, '{}'::jsonb)
  where id = v_pago.id;

  -- Si la reserva expiró antes del webhook, intentar reactivar; si el horario fue tomado, marcar conciliación sin desechar el pago
  begin
    update public.reservas
    set monto_abonado_clp = v_nuevo_abono,
        estado = v_nuevo_estado,
        expira_pago_en = null
    where id = v_rsv.id;
  exception when exclusion_violation then
    update public.pagos_tuu
    set requiere_conciliacion = true,
        detalle_conciliacion = 'Pago tardío recibido tras expiración; horario ya ocupado por otro paciente'
    where id = v_pago.id;
    return jsonb_build_object('ok', true, 'requiere_conciliacion', true, 'motivo', 'horario_ocupado');
  end;

  return jsonb_build_object('ok', true, 'idempotent_replay', false, 'estado', v_nuevo_estado);
end;
$$;

revoke all on function public.confirmar_pago_tuu(text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirmar_pago_tuu(text, integer, text, jsonb) to service_role;

-- -------------------------------------------------------------------------
-- 6. ENDURECIMIENTO RLS CON MÍNIMO PRIVILEGIO
-- -------------------------------------------------------------------------
drop policy if exists "Solo equipo autenticado gestiona bloques" on public.bloques_agenda;
create policy "Solo admin clinica gestiona bloques"
  on public.bloques_agenda for all to authenticated
  using (public.es_admin_clinica()) with check (public.es_admin_clinica());

drop policy if exists "Solo equipo autenticado gestiona pacientes" on public.pacientes;
create policy "Solo admin clinica gestiona pacientes"
  on public.pacientes for all to authenticated
  using (public.es_admin_clinica()) with check (public.es_admin_clinica());

drop policy if exists "Solo equipo autenticado gestiona reservas" on public.reservas;
create policy "Solo admin clinica lee reservas"
  on public.reservas for select to authenticated using (public.es_admin_clinica());
create policy "Solo admin clinica crea reservas"
  on public.reservas for insert to authenticated with check (public.es_admin_clinica());
create policy "Solo admin clinica actualiza reservas"
  on public.reservas for update to authenticated
  using (public.es_admin_clinica()) with check (public.es_admin_clinica());

drop policy if exists "Solo equipo autenticado ve pagos TUU" on public.pagos_tuu;
create policy "Solo admin clinica lee pagos"
  on public.pagos_tuu for select to authenticated using (public.es_admin_clinica());

drop policy if exists "Solo equipo autenticado lee fichas" on public.fichas_ingreso_pacientes;
create policy "Solo admin clinica lee fichas"
  on public.fichas_ingreso_pacientes for select to authenticated using (public.es_admin_clinica());

commit;
