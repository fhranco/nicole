// Vercel Serverless Function: Webhook oficial de TUU para confirmar abono y habilitar token de ficha
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Faltan variables de Supabase' });
  }

  const body = req.body || {};
  const reference = body.x_reference || body.reference || '';
  const status = String(body.x_result || body.status || '').toLowerCase();
  const amount = Number(body.x_amount || body.amount || 0);

  if (!reference.startsWith('RES-')) {
    return res.status(400).json({ error: 'Referencia inválida' });
  }
  const reservaId = reference.replace('RES-', '');
  const isPaid = status === 'completed' || status === 'paid' || status === 'approved';

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/pagos_tuu?tuu_transaction_id=eq.${encodeURIComponent(reference)}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({
        tuu_status: isPaid ? 'paid' : 'failed',
        tuu_raw_payload: body
      })
    });

    if (isPaid) {
      const rsvRes = await fetch(`${SUPABASE_URL}/rest/v1/reservas?id=eq.${reservaId}&limit=1`, { headers: sbHeaders });
      const rows = await rsvRes.json();
      const rsv = rows?.[0];
      if (rsv) {
        const nuevoAbono = (rsv.monto_abonado_clp || 0) + amount;
        const nuevoEstado = (rsv.credito_previo_clp + nuevoAbono) >= rsv.precio_total_clp ? 'pagada' : 'abonada';
        await fetch(`${SUPABASE_URL}/rest/v1/reservas?id=eq.${reservaId}`, {
          method: 'PATCH',
          headers: sbHeaders,
          body: JSON.stringify({
            monto_abonado_clp: nuevoAbono,
            estado: nuevoEstado
          })
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
