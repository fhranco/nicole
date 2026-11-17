// Vercel Serverless Function: Webhook oficial TUU -> RPC atómica confirmar_pago_tuu()
import crypto from 'crypto';

function verifyTuuSignature(body, secret) {
  if (!secret || !body?.x_signature) return !body?.x_signature;
  const payload = { ...body };
  const receivedSig = String(payload.x_signature);
  delete payload.x_signature;
  const sorted = Object.keys(payload).sort().map((k) => `${k}${payload[k] ?? ''}`).join('');
  const expected = crypto.createHmac('sha256', secret).update(sorted).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(receivedSig, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch (_) {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TUU_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Faltan variables de Supabase' });
  }

  const body = req.body || {};
  if (body.x_signature && !verifyTuuSignature(body, TUU_SECRET_KEY)) {
    return res.status(401).json({ error: 'Firma x_signature inválida' });
  }

  const reference = String(body.x_reference || body.reference || '').trim();
  const status = String(body.x_result || body.status || '').trim().toLowerCase();
  const currency = String(body.x_currency || 'CLP').toUpperCase();
  const amount = Math.round(Number(body.x_amount || body.amount || 0));

  if (!reference.startsWith('RES-') || currency !== 'CLP') {
    return res.status(400).json({ error: 'Referencia o moneda inválida' });
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };

  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirmar_pago_tuu`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        p_reference: reference,
        p_monto_clp: amount,
        p_tuu_status: status,
        p_raw_payload: body
      })
    });
    const rpcData = await rpcRes.json();
    if (!rpcRes.ok) {
      return res.status(400).json({ error: rpcData?.message || 'Error al confirmar pago' });
    }
    return res.status(200).json(rpcData);
  } catch (err) {
    return res.status(500).json({ error: 'Error interno al procesar webhook' });
  }
}
