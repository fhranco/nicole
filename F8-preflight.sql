-- =========================================================================
-- F8-PREFLIGHT.SQL (SOLO LECTURA — VERIFICACIÓN PREVIA A LA MIGRACIÓN)
-- NO EJECUTAR SIN REVISIÓN. NO MODIFICA DATOS NI ESQUEMAS.
-- =========================================================================

-- 1. Verificar extensión btree_gist disponible
select name, default_version, installed_version
from pg_available_extensions
where name = 'btree_gist';

-- 2. Detectar posibles reservas activas solapadas que impedirían crear EXCLUDE USING gist
with rangos as (
  select
    r.id,
    r.servicio_slug,
    r.sede_slug,
    r.estado,
    tstzrange(
      r.fecha_hora,
      r.fecha_hora + make_interval(mins => coalesce(s.duracion_min, 60)),
      '[)'
    ) as rango
  from public.reservas r
  left join public.servicios s on s.slug = r.servicio_slug
  where r.estado in ('pendiente_pago', 'abonada', 'pagada', 'completada')
)
select a.id as reserva_a, b.id as reserva_b, a.rango as rango_a, b.rango as rango_b
from rangos a
join rangos b on a.id < b.id and a.rango && b.rango;

-- 3. Detectar posibles bloques horarios activos solapados en bloques_agenda
select a.id as bloque_a, b.id as bloque_b, a.dia_semana, a.fecha_especifica, a.hora_inicio, a.hora_fin
from public.bloques_agenda a
join public.bloques_agenda b
  on a.id < b.id
 and a.activo = true
 and b.activo = true
 and (
   (a.fecha_especifica is not null and a.fecha_especifica = b.fecha_especifica)
   or (a.fecha_especifica is null and b.fecha_especifica is null and a.dia_semana = b.dia_semana)
 )
 and a.hora_inicio < b.hora_fin
 and a.hora_fin > b.hora_inicio;

-- 4. Verificar usuarios existentes en auth.users para poblar administradores_clinica
select id, email, created_at
from auth.users
order by created_at asc;

-- 5. Línea base de integridad financiera previa (para comparar post-migración)
select
  count(*) as total_reservas,
  coalesce(sum(monto_abonado_clp), 0) as suma_abonado_reservas
from public.reservas;

select
  count(*) as total_pagos_paid,
  coalesce(sum(monto_clp), 0) as suma_pagos_paid
from public.pagos_tuu
where tuu_status = 'paid';
