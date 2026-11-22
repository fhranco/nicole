// Vercel Serverless Function: Crea paciente + reserva pendiente (15 min) y genera preferencia Checkout Pro de Mercado Pago
function getSantiagoOffsetForDate(dateStr) {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    timeZoneName: 'shortOffset'
  }).formatToParts(probe);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-3';
  const match = tz.match(/GMT([+-]\d+)/);
  if (!match) return '-03:00';
  const hr = Number(match[1]);
  return `${hr < 0 ? '-' : '+'}${String(Math.abs(hr)).padStart(2, '0')}:00`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MP_ACCESS_TOKEN, MP_ENV = 'production' } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Faltan variables de Supabase en el servidor' });
  }
  if (!MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Falta configurar MP_ACCESS_TOKEN de Mercado Pago en el servidor' });
  }

  const { service, sede, modalidad, date, time, payMode, idempotencyKey, patient } = req.body || {};
  const cleanEmailInput = String(patient?.email || '').trim().toLowerCase();
  if (
    !service ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ||
    !/^\d{2}:\d{2}$/.test(String(time || '')) ||
    !patient?.name ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmailInput)
  ) {
    return res.status(400).json({ error: 'Datos inválidos o incompletos para crear la reserva' });
  }
  const safePayMode = payMode === 'total' ? 'total' : 'abono';
  const safeModalidad = modalidad === 'online' ? 'online' : 'presencial';

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };

  try {
    // 0. Expirar reservas pendientes vencidas (>15 min)
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/expirar_reservas_pendientes`, {
      method: 'POST',
      headers: sbHeaders
    }).catch(() => {});

    // 1. Identificar/registrar paciente priorizando RUT normalizado (y email como respaldo)
    const cleanEmail = patient.email.trim().toLowerCase();
    const cleanRut = patient.rut ? patient.rut.trim() : '';
    const rutNorm = cleanRut.replace(/[^0-9kK]/g, '').toUpperCase();
    const pacPayload = {
      nombre_completo: patient.name.trim(),
      telefono: (patient.phone || '').trim(),
      rut: cleanRut || null,
      email: cleanEmail
    };

    let pacienteId = null;
    if (rutNorm) {
      const byRutRes = await fetch(`${SUPABASE_URL}/rest/v1/pacientes?rut_normalizado=eq.${encodeURIComponent(rutNorm)}&select=id&limit=1`, {
        headers: sbHeaders
      });
      const byRutRows = await byRutRes.json();
      if (Array.isArray(byRutRows) && byRutRows[0]?.id) {
        pacienteId = byRutRows[0].id;
        await fetch(`${SUPABASE_URL}/rest/v1/pacientes?id=eq.${pacienteId}`, {
          method: 'PATCH',
          headers: sbHeaders,
          body: JSON.stringify(pacPayload)
        });
      }
    }

    if (!pacienteId) {
      const pacRes = await fetch(`${SUPABASE_URL}/rest/v1/pacientes?on_conflict=email`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(pacPayload)
      });
      const pacRows = await pacRes.json();
      pacienteId = pacRows?.[0]?.id;
    }
    if (!pacienteId) throw new Error('No se pudo registrar al paciente');

    // 2. Calcular precio, duración efectiva, crédito verificado y monto en el servidor
    const servicioSlug = service === 'consulta_inicial'
      ? (modalidad === 'online' ? 'consulta_inicial_online' : 'consulta_inicial_presencial')
      : service;

    const srvRes = await fetch(`${SUPABASE_URL}/rest/v1/servicios?slug=eq.${servicioSlug}&limit=1`, { headers: sbHeaders });
    const srvRows = await srvRes.json();
    const srv = srvRows?.[0];
    if (!srv) throw new Error('Servicio no encontrado');

    const credRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verificar_credito_previo`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({ p_email: patient.email, p_rut: patient.rut || '', p_servicio_destino: servicioSlug })
    });
    const creditoPrevio = Number(await credRes.json()) || 0;
    const neto = Math.max(0, srv.precio_clp - creditoPrevio);
    const montoCobrar = Math.round(payMode === 'total' ? neto : Math.min(srv.abono_sugerido_clp || 10000, neto));

    // 3. Crear reserva en pendiente_pago (GiST impide solapamiento concurrente -> 23P01)
    const offset = getSantiagoOffsetForDate(date);
    const fechaHora = `${date}T${time}:00${offset}`;
    const expiraEn = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const rsvRes = await fetch(`${SUPABASE_URL}/rest/v1/reservas`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        paciente_id: pacienteId,
        servicio_slug: servicioSlug,
        sede_slug: sede || (modalidad === 'online' ? 'online' : 'punta_arenas'),
        modalidad: modalidad || 'presencial',
        fecha_hora: fechaHora,
        fecha_inicio: fechaHora,
        duracion_min: srv.duracion_min || 60,
        precio_total_clp: srv.precio_clp,
        credito_previo_clp: creditoPrevio,
        monto_abonado_clp: 0,
        estado: 'pendiente_pago',
        expira_pago_en: expiraEn
      })
    });

    const rsvText = await rsvRes.text();
    let rsvRows = [];
    try { rsvRows = JSON.parse(rsvText); } catch (_) {}

    if (!rsvRes.ok) {
      if (rsvRes.status === 409 || rsvText.includes('23P01') || rsvText.includes('reservas_no_solapamiento_global')) {
        return res.status(409).json({ error: 'Ese horario acaba de ser reservado.', code: 'SLOT_TAKEN' });
      }
      throw new Error('No se pudo crear la reserva');
    }

    const reserva = rsvRows?.[0];
    if (!reserva?.id) throw new Error('No se pudo crear la reserva');

    // 4. Crear Orden Checkout Pro en Mercado Pago (Orders API v1)
    const rawHost = String(req.headers.host || '').toLowerCase();
    const allowedHosts = new Set([
      'nicole-virid.vercel.app',
      '127.0.0.1:8080',
      'localhost:8080',
      String(process.env.VERCEL_URL || '').toLowerCase(),
      String(process.env.VERCEL_PROJECT_PRODUCTION_URL || '').toLowerCase()
    ].filter(Boolean));
    const safeHost = allowedHosts.has(rawHost) ? rawHost : (process.env.VERCEL_PROJECT_PRODUCTION_URL || 'nicole-virid.vercel.app');
    const proto = safeHost.startsWith('127.0.0.1') || safeHost.startsWith('localhost') ? 'http' : 'https';
    const origin = `${proto}://${safeHost}`;
    const reference = `RES-${reserva.id}`;
    const mpIdempotencyKey = String(idempotencyKey || reference).slice(0, 64);

    const mpOrderBody = {
      type: 'online',
      processing_mode: 'manual',
      total_amount: String(montoCobrar),
      external_reference: reference,
      payer: {
        email: cleanEmail
      },
      items: [
        {
          title: `${srv.nombre} (${payMode === 'total' ? 'Pago total' : 'Abono reserva'})`,
          quantity: 1,
          unit_price: String(montoCobrar)
        }
      ],
      config: {
        online: {
          success_url: `${origin}/ingreso-paciente.html?token=${reserva.intake_token}`,
          failure_url: `${origin}/reservar.html?pago=cancelado`,
          pending_url: `${origin}/reservar.html?pago=pendiente`
        }
      }
    };

    const mpRes = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': mpIdempotencyKey
      },
      body: JSON.stringify(mpOrderBody)
    });

    const mpData = await mpRes.json();
    const paymentUrl = mpData?.checkout_url;

    if (!mpRes.ok || !paymentUrl) {
      // Liberar el horario inmediatamente si Mercado Pago rechazó la orden
      await fetch(`${SUPABASE_URL}/rest/v1/reservas?id=eq.${reserva.id}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify({ estado: 'cancelada', motivo_cancelacion: 'error_mercadopago' })
      }).catch(() => {});
      const mpErrMsg = mpData?.errors?.[0]?.message || mpData?.message || `Mercado Pago HTTP ${mpRes.status} sin checkout_url`;
      throw new Error(mpErrMsg);
    }

    // 5. Registrar intento en pagos_tuu
    await fetch(`${SUPABASE_URL}/rest/v1/pagos_tuu`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        reserva_id: reserva.id,
        paciente_id: pacienteId,
        concepto: payMode === 'total' ? 'pago_total_mp' : 'abono_reserva_mp',
        monto_clp: montoCobrar,
        tuu_transaction_id: reference,
        tuu_status: 'pending',
        origen_pago: 'tuu',
        idempotency_key: idempotencyKey || reference,
        tuu_raw_payload: {
          provider: 'mercadopago_orders',
          order_id: mpData.id,
          status: mpData.status
        }
      })
    });

    return res.status(200).json({
      paymentUrl,
      reservaId: reserva.id,
      orderId: mpData.id,
      expiraEn
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Error interno' });
  }
}
