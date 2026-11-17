-- =========================================================================
-- BACKEND CLÍNICO SUPABASE: SERVICIOS, RESERVAS, ABONOS TUU Y FICHAS
-- Proyecto: pacientes (bfzeejjzgvhfybtfeajg)
-- Ejecutar completo en Supabase -> SQL Editor
-- =========================================================================

-- 1. CATÁLOGO DE SERVICIOS (Valores oficiales CLP)
create table if not exists public.servicios (
  slug text primary key,
  nombre text not null,
  modalidad text not null, -- 'online', 'presencial', 'hibrido'
  precio_clp integer not null,
  abono_sugerido_clp integer not null,
  duracion_min integer not null default 60,
  sesiones_incluidas integer not null default 1,
  activo boolean not null default true
);

insert into public.servicios (slug, nombre, modalidad, precio_clp, abono_sugerido_clp, duracion_min, sesiones_incluidas)
values
  ('consulta_inicial_online', 'Consulta Nutricional Inicial (Online)', 'online', 40000, 10000, 60, 1),
  ('consulta_inicial_presencial', 'Consulta Nutricional Inicial (Presencial Punta Arenas)', 'presencial', 45000, 10000, 60, 1),
  ('evaluacion_epixlife', 'Evaluación Integral + Epixlife', 'hibrido', 120000, 10000, 60, 2),
  ('programa_90_dias', 'Programa Integral de 90 Días', 'hibrido', 240000, 10000, 60, 6)
on conflict (slug) do update set
  nombre = excluded.nombre,
  modalidad = excluded.modalidad,
  precio_clp = excluded.precio_clp,
  abono_sugerido_clp = excluded.abono_sugerido_clp,
  duracion_min = excluded.duracion_min,
  sesiones_incluidas = excluded.sesiones_incluidas;

-- 1B. SEDES / MODALIDADES DE ATENCIÓN (Punta Arenas, Puerto Natales, Porvenir, Online)
create table if not exists public.sedes (
  slug text primary key,
  nombre text not null,
  tipo text not null, -- 'online' | 'presencial'
  direccion text,
  activa boolean not null default true
);

insert into public.sedes (slug, nombre, tipo, direccion)
values
  ('online', 'Online · Todo Chile', 'online', 'Videollamada (Google Meet)'),
  ('punta_arenas', 'Punta Arenas (Presencial)', 'presencial', 'Ortho Med · Av. Pdte. Manuel Bulnes 01055'),
  ('puerto_natales', 'Puerto Natales (Presencial)', 'presencial', 'Consulta Puerto Natales'),
  ('porvenir', 'Porvenir (Presencial)', 'presencial', 'Consulta Porvenir')
on conflict (slug) do update set
  nombre = excluded.nombre,
  tipo = excluded.tipo,
  direccion = excluded.direccion;

-- 1C. BLOQUES DE AGENDA CONFIGURABLES POR NICOLE (Semanal o por fecha de viaje)
create table if not exists public.bloques_agenda (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sede_slug text not null references public.sedes(slug),
  dia_semana smallint,          -- 0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb (si es recurrente)
  fecha_especifica date,        -- Si tiene fecha puntual (ej: viaje a Puerto Natales o Porvenir), sobreescribe/agrega ese día
  hora_inicio time not null,
  hora_fin time not null,
  duracion_min integer not null default 60,
  modalidad_habilitada text not null default 'presencial', -- 'presencial' | 'online' | 'ambas'
  activo boolean not null default true
);

alter table public.bloques_agenda
  add column if not exists modalidad_habilitada text not null default 'presencial';

create index if not exists idx_bloques_sede_dia on public.bloques_agenda(sede_slug, dia_semana, fecha_especifica);

-- 2. PACIENTES (Para acumular abonos progresivos: Inicial -> Epixlife -> 90 Días)
create table if not exists public.pacientes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre_completo text not null,
  rut text,
  email text not null unique,
  telefono text not null
);

-- 3. RESERVAS DE HORAS
create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  paciente_id uuid references public.pacientes(id) on delete set null,
  servicio_slug text not null references public.servicios(slug),
  sede_slug text not null references public.sedes(slug) default 'online',
  modalidad text not null, -- 'online' | 'presencial'
  fecha_hora timestamptz not null,
  precio_total_clp integer not null,
  credito_previo_clp integer not null default 0, -- Ej: $40.000 de Consulta Inicial al subir a Epixlife ($80.000 saldo)
  monto_abonado_clp integer not null default 0,
  saldo_pendiente_clp integer generated always as (greatest(precio_total_clp - credito_previo_clp - monto_abonado_clp, 0)) stored,
  estado text not null default 'pendiente_pago', -- 'pendiente_pago' | 'abonada' | 'pagada' | 'completada' | 'cancelada'
  intake_token uuid not null unique default gen_random_uuid(),
  intake_completado boolean not null default false,
  google_event_id text,
  notas text
);

create index if not exists idx_reservas_fecha on public.reservas(fecha_hora);
create index if not exists idx_reservas_token on public.reservas(intake_token);

-- 4. PAGOS Y ABONOS EN TUU (Haulmer)
create table if not exists public.pagos_tuu (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  paciente_id uuid references public.pacientes(id) on delete set null,
  concepto text not null, -- 'abono_reserva' | 'pago_total' | 'saldo_final' | 'upgrade_epixlife' | 'upgrade_programa'
  monto_clp integer not null,
  tuu_transaction_id text unique,
  tuu_status text not null default 'pending', -- 'pending' | 'paid' | 'failed'
  tuu_raw_payload jsonb not null default '{}'::jsonb
);

-- 5. FICHAS DE INGRESO CLÍNICO (31 preguntas + archivos)
create table if not exists public.fichas_ingreso_pacientes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reserva_id uuid references public.reservas(id) on delete set null,
  paciente_id uuid references public.pacientes(id) on delete set null,
  intake_token uuid,
  fecha_hoy date,
  nombre_completo text not null,
  telefono text not null,
  rut text,
  direccion text,
  email text not null,
  fecha_nacimiento date,
  edad integer,
  actividad_laboral text,
  enfermedades_actuales text,
  tratamiento_actual text,
  historia_clinica text,
  actividad_fisica text,
  rastreo_resumen text,
  rastreo_sistemas jsonb not null default '{}'::jsonb,
  motivo_consulta text,
  dia_tipico text,
  archivos_urls jsonb not null default '[]'::jsonb,
  origen text
);

-- 6. SEGURIDAD RLS
alter table public.servicios enable row level security;
alter table public.sedes enable row level security;
alter table public.bloques_agenda enable row level security;
alter table public.pacientes enable row level security;
alter table public.reservas enable row level security;
alter table public.pagos_tuu enable row level security;
alter table public.fichas_ingreso_pacientes enable row level security;

drop policy if exists "Lectura publica de servicios activos" on public.servicios;
create policy "Lectura publica de servicios activos"
  on public.servicios for select to anon, authenticated using (activo = true);

drop policy if exists "Lectura publica de sedes activas" on public.sedes;
create policy "Lectura publica de sedes activas"
  on public.sedes for select to anon, authenticated using (activa = true);

drop policy if exists "Lectura publica de bloques activos" on public.bloques_agenda;
create policy "Lectura publica de bloques activos"
  on public.bloques_agenda for select to anon, authenticated using (activo = true);

drop policy if exists "Solo equipo autenticado gestiona bloques" on public.bloques_agenda;
create policy "Solo equipo autenticado gestiona bloques"
  on public.bloques_agenda for all to authenticated using (true) with check (true);

drop policy if exists "Solo equipo autenticado gestiona pacientes" on public.pacientes;
create policy "Solo equipo autenticado gestiona pacientes"
  on public.pacientes for all to authenticated using (true) with check (true);

drop policy if exists "Solo equipo autenticado gestiona reservas" on public.reservas;
create policy "Solo equipo autenticado gestiona reservas"
  on public.reservas for all to authenticated using (true) with check (true);

drop policy if exists "Solo equipo autenticado ve pagos TUU" on public.pagos_tuu;
create policy "Solo equipo autenticado ve pagos TUU"
  on public.pagos_tuu for all to authenticated using (true) with check (true);

drop policy if exists "Permitir ingreso de fichas con token" on public.fichas_ingreso_pacientes;
create policy "Permitir ingreso de fichas con token"
  on public.fichas_ingreso_pacientes for insert to anon, authenticated
  with check (intake_token is not null);

drop policy if exists "Solo equipo autenticado lee fichas" on public.fichas_ingreso_pacientes;
create policy "Solo equipo autenticado lee fichas"
  on public.fichas_ingreso_pacientes for select to authenticated using (true);

-- 7. FUNCIÓN SEGURA PARA VALIDAR TOKEN DE INGRESO POST-RESERVA/ABONO
create or replace function public.validar_token_ingreso(p_token uuid)
returns table (
  valido boolean,
  reserva_id uuid,
  paciente_id uuid,
  nombre_completo text,
  email text,
  telefono text,
  rut text,
  servicio text,
  fecha_hora timestamptz,
  intake_completado boolean
)
language sql
security definer
set search_path = public
as $$
  select
    (r.estado in ('abonada', 'pagada', 'completada')) as valido,
    r.id as reserva_id,
    r.paciente_id,
    p.nombre_completo,
    p.email,
    p.telefono,
    p.rut,
    s.nombre as servicio,
    r.fecha_hora,
    r.intake_completado
  from public.reservas r
  left join public.pacientes p on p.id = r.paciente_id
  left join public.servicios s on s.slug = r.servicio_slug
  where r.intake_token = p_token
  limit 1;
$$;

grant execute on function public.validar_token_ingreso(uuid) to anon, authenticated;

-- 7B. FUNCIÓN SEGURA PARA CONSULTAR HORAS OCUPADAS DE UNA FECHA/SEDE SIN EXPONER PACIENTES
create or replace function public.horas_ocupadas_sede(p_fecha date, p_sede text default null)
returns table (fecha_hora timestamptz)
language sql
security definer
set search_path = public
as $$
  select r.fecha_hora
  from public.reservas r
  where r.fecha_hora::date = p_fecha
    and r.estado in ('pendiente_pago', 'abonada', 'pagada', 'completada')
    and (p_sede is null or r.sede_slug = p_sede);
$$;

grant execute on function public.horas_ocupadas_sede(date, text) to anon, authenticated;

-- 7C. VERIFICACIÓN AUTOMÁTICA DE ABONO PREVIO POR RUT/EMAIL (NUNCA A CRITERIO DEL CLIENTE)
create or replace function public.verificar_credito_previo(
  p_email text,
  p_rut text,
  p_servicio_destino text
)
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce((
    select
      case
        when p_servicio_destino = 'evaluacion_epixlife'
          and r.servicio_slug in ('consulta_inicial_online', 'consulta_inicial_presencial')
          then least(r.monto_abonado_clp + r.credito_previo_clp, 40000)
        when p_servicio_destino = 'programa_90_dias'
          and r.servicio_slug = 'evaluacion_epixlife'
          then least(r.monto_abonado_clp + r.credito_previo_clp, 120000)
        else 0
      end
    from public.reservas r
    join public.pacientes p on p.id = r.paciente_id
    where r.estado in ('pagada', 'completada', 'abonada')
      and (
        (coalesce(trim(p_email), '') <> '' and lower(p.email) = lower(trim(p_email)))
        or (coalesce(trim(p_rut), '') <> '' and regexp_replace(lower(coalesce(p.rut, '')), '[^0-9k]', '', 'g') = regexp_replace(lower(p_rut), '[^0-9k]', '', 'g'))
      )
    order by r.created_at desc
    limit 1
  ), 0);
$$;

grant execute on function public.verificar_credito_previo(text, text, text) to anon, authenticated;

-- 8. BUCKET PRIVADO PARA EXÁMENES MÉDICOS (máx. 5 archivos de 5 MB)
insert into storage.buckets (id, name, public)
values ('examenes-pacientes', 'examenes-pacientes', false)
on conflict (id) do nothing;

drop policy if exists "Permitir subida publica de examenes" on storage.objects;
create policy "Permitir subida publica de examenes"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'examenes-pacientes');

drop policy if exists "Solo equipo autenticado lee examenes" on storage.objects;
create policy "Solo equipo autenticado lee examenes"
  on storage.objects for select to authenticated
  using (bucket_id = 'examenes-pacientes');

-- 9. PERMISOS PARA BACKEND (service_role)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
