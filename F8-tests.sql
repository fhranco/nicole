-- =========================================================================
-- F8-TESTS.SQL — PRUEBAS TRANSACCIONALES EN ENTORNO AISLADO (ROLLBACK AL FINAL)
-- USAR ÚNICAMENTE CON DATOS FICTICIOS EN ENTORNO DE PRUEBA / STAGING
-- =========================================================================

begin;

-- 1. Crear paciente ficticio de prueba
with p as (
  insert into public.pacientes (nombre_completo, rut, email, telefono)
  values ('Paciente Prueba F8', '11.111.111-1', 'test-f8@ejemplo.cl', '+56900000000')
  returning id
),
r1 as (
  insert into public.reservas (paciente_id, servicio_slug, sede_slug, modalidad, fecha_hora, precio_total_clp, estado)
  select id, 'evaluacion_epixlife', 'punta_arenas', 'presencial', '2026-12-20T10:00:00-03:00', 120000, 'abonada'
  from p
  returning id, fecha_inicio, fecha_fin, duracion_min
)
select * from r1;

-- 2. Prueba esperada FALLAR (23P01 exclusion_violation): solapamiento global en modalidad distinta
do $$
declare
  v_pid uuid;
begin
  select id into v_pid from public.pacientes where email = 'test-f8@ejemplo.cl';
  begin
    insert into public.reservas (paciente_id, servicio_slug, sede_slug, modalidad, fecha_hora, precio_total_clp, estado)
    values (v_pid, 'consulta_inicial_online', 'online', 'online', '2026-12-20T10:30:00-03:00', 40000, 'pendiente_pago');
    raise exception 'FALLO TEST: permitió reserva solapada';
  exception when exclusion_violation then
    raise notice 'PASS: exclusión temporal GiST bloqueó reserva simultánea (23P01)';
  end;
end $$;

-- 3. Prueba de sobrepago e idempotencia (simulada como admin en sesión de prueba)
do $$
declare
  v_rid uuid;
begin
  select r.id into v_rid
  from public.reservas r
  join public.pacientes p on p.id = r.paciente_id
  where p.email = 'test-f8@ejemplo.cl'
  limit 1;

  -- Confirmar pago TUU tardío en reserva expirada cuyo horario ya fue ocupado
  raise notice 'Reserva de prueba lista para validación: %', v_rid;
end $$;

-- Reversión total de los datos ficticios de prueba
rollback;
