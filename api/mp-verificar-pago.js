// Vercel Serverless Function: Verificación directa de pago en Mercado Pago Orders API v1 por intake_token
// Actúa como respaldo automático si el webhook de Mercado Pago demora o falla.

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MP_ACCESS_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Faltan variables de entorno en el servidor' });
  }

  const urlObj = new URL(req.url || '/', 'http://localhost');
  const token = String(req.body?.token || urlObj.searchParams.get('token') || '').trim();
  if (!token || !/^[0-9a-f-]{20,}$/i.test(token)) {
    return res.status(400).json({ error: 'Token inválido' });
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };

  try {
    const resRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reservas?intake_token=eq.${encodeURIComponent(token)}&select=id,estado&limit=1`,
      { headers: sbHeaders }
    );
    const reservas = await resRes.json();
    const reserva = reservas?.[0];
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

    if (reserva.estado === 'abonada' || reserva.estado === 'pagada_total') {
      return res.status(200).json({ ok: true, confirmed: true, estado: reserva.estado });
    }

    const pagoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pagos_tuu?reserva_id=eq.${reserva.id}&order=created_at.desc&limit=1&select=tuu_transaction_id,tuu_raw_payload,monto_clp`,
      { headers: sbHeaders }
    );
    const pagos = await pagoRes.json();
    const pago = pagos?.[0];
    const orderId = pago?.tuu_raw_payload?.order_id;
    if (!orderId) {
      return res.status(200).json({ ok: true, confirmed: false, reason: 'sin_order_id' });
    }

    const mpRes = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });
    if (!mpRes.ok) {
      return res.status(200).json({ ok: false, confirmed: false, mp_http: mpRes.status });
    }
    const order = await mpRes.json();
    const ordStatus = String(order.status || '').toLowerCase();
    const ordDetail = String(order.status_detail || '').toLowerCase();

    if (ordStatus === 'processed' || ordDetail === 'accredited') {
      const reference = String(order.external_reference || pago.tuu_transaction_id || `RES-${reserva.id}`).trim();
      const amount = Math.round(Number(order.total_paid_amount || order.total_amount || pago.monto_clp || 0));
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirmar_pago_tuu`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          p_reference: reference,
          p_monto_clp: amount,
          p_tuu_status: 'paid',
          p_raw_payload: {
            provider: 'mercadopago_orders_verify',
            order_id: order.id,
            status: order.status,
            status_detail: order.status_detail,
            total_amount: order.total_amount
          }
        })
      });
      const rpcData = await rpcRes.json();
      return res.status(200).json({ ok: rpcRes.ok, confirmed: rpcRes.ok, rpc: rpcData });
    }

    return res.status(200).json({ ok: true, confirmed: false, mp_status: ordStatus, mp_detail: ordDetail });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Error al verificar pago' });
  }
}
