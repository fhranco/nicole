// Vercel Serverless Function: Crea paciente + reserva pendiente en Supabase y genera pago en TUU (Haulmer)
import crypto from 'crypto';

const TUU_ENDPOINTS = {
  sandbox: 'https://frontend-api.payment.haulmer.dev/v1/payment',
  production: 'https://core.payment.haulmer.com/api/v1/payment'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TUU_ACCOUNT_ID, TUU_SECRET_KEY, TUU_ENV = 'sandbox' } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Faltan variables de Supabase en el servidor' });
  }
  if (!TUU_ACCOUNT_ID || !TUU_SECRET_KEY) {
    return res.status(500).json({ error: 'Faltan credenciales TUU_ACCOUNT_ID / TUU_SECRET_KEY' });
  }

  const { service, sede, modalidad, date, time, payMode, patient } = req.body || {};
  if (!service || !date || !time || !patient?.email || !patient?.name) {
    return res.status(400).json({ error: 'Datos incompletos para crear la reserva' });
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };

  try {
    // 1. Upsert paciente por email
    const pacRes = await fetch(`${SUPABASE_URL}/rest/v1/pacientes?on_conflict=email`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        nombre_completo: patient.name,
        telefono: patient.phone || '',
        rut: patient.rut || null,
        email: patient.email.trim().toLowerCase()
      })
    });
    const pacRows = await pacRes.json();
    const pacienteId = pacRows?.[0]?.id;
    if (!pacienteId) throw new Error('No se pudo registrar al paciente');

    // 2. Calcular precio, crédito previo verificado y abono ($10.000 CLP) en el servidor
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
    const montoCobrar = payMode === 'total' ? neto : Math.min(srv.abono_sugerido_clp || 10000, neto);

    // 3. Crear reserva en pendiente_pago
    const fechaHora = `${date}T${time}:00-03:00`;
    const rsvRes = await fetch(`${SUPABASE_URL}/rest/v1/reservas`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        paciente_id: pacienteId,
        servicio_slug: servicioSlug,
        sede_slug: sede || (modalidad === 'online' ? 'online' : 'punta_arenas'),
        modalidad: modalidad || 'presencial',
        fecha_hora: fechaHora,
        precio_total_clp: srv.precio_clp,
        credito_previo_clp: creditoPrevio,
        monto_abonado_clp: 0,
        estado: 'pendiente_pago'
      })
    });
    const rsvRows = await rsvRes.json();
    const reserva = rsvRows?.[0];
    if (!reserva?.id) throw new Error('No se pudo crear la reserva');

    // 4. Crear Payment Intent en TUU
    const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
    const reference = `RES-${reserva.id}`;
    const tuuBody = {
      x_account_id: TUU_ACCOUNT_ID,
      x_amount: String(montoCobrar),
      x_currency: 'CLP',
      x_reference: reference,
      x_customer_email: patient.email,
      x_customer_first_name: patient.name.split(' ')[0] || patient.name,
      x_customer_last_name: patient.name.split(' ').slice(1).join(' ') || '-',
      x_url_callback: `${origin}/api/tuu-webhook`,
      x_url_complete: `${origin}/ingreso-paciente.html?token=${reserva.intake_token}`,
      x_url_cancel: `${origin}/reservar.html?pago=cancelado`
    };

    // Firma HMAC SHA-256 según estándar TUU si se requiere
    const sorted = Object.keys(tuuBody).sort().map((k) => `${k}${tuuBody[k]}`).join('');
    tuuBody.x_signature = crypto.createHmac('sha256', TUU_SECRET_KEY).update(sorted).digest('hex');

    const tuuEndpoint = TUU_ENDPOINTS[TUU_ENV === 'production' ? 'production' : 'sandbox'];
    const tuuRes = await fetch(tuuEndpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-REDIRECT': 'false' },
      body: JSON.stringify(tuuBody)
    });

    const redirectLoc = tuuRes.headers.get('location');
    const rawText = await tuuRes.text();
    let tuuData = {};
    try { tuuData = JSON.parse(rawText); } catch (_) { tuuData = { location: redirectLoc || null }; }

    const paymentUrl = redirectLoc || tuuData?.url || tuuData?.payment_url || tuuData?.redirect_url;
    if (!paymentUrl) {
      throw new Error(tuuData?.message || `TUU HTTP ${tuuRes.status} sin URL de pago`);
    }

    // 5. Registrar intento en pagos_tuu
    await fetch(`${SUPABASE_URL}/rest/v1/pagos_tuu`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        reserva_id: reserva.id,
        paciente_id: pacienteId,
        concepto: payMode === 'total' ? 'pago_total' : 'abono_reserva',
        monto_clp: montoCobrar,
        tuu_transaction_id: reference,
        tuu_status: 'pending',
        tuu_raw_payload: tuuData
      })
    });

    return res.status(200).json({ paymentUrl, reservaId: reserva.id, intakeToken: reserva.intake_token });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Error interno' });
  }
}
