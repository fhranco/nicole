// Vercel Serverless Function: Webhook oficial Mercado Pago -> verificación API + RPC atómica confirmar_pago_tuu()
import crypto from 'crypto';

function verifyMpSignature(req, secret) {
  if (!secret) return true; // Verificación HMAC opcional si MP_WEBHOOK_SECRET está configurado
  const sigHeader = req.headers['x-signature'];
  const reqId = req.headers['x-request-id'];
  if (!sigHeader || !reqId) return false;

  const parts = {};
  for (const seg of String(sigHeader).split(',')) {
    const [k, v] = seg.split('=').map((s) => s.trim());
    if (k && v) parts[k] = v;
  }
  if (!parts.ts || !parts.v1) return false;

  const tsNum = Number(parts.ts);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > 300) return false;

  const dataId = req.body?.data?.id || req.query?.['data.id'] || '';
  const manifest = `id:${dataId};request-id:${reqId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(parts.v1, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch (_) {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Faltan variables de Supabase o Mercado Pago' });
  }

  if (MP_WEBHOOK_SECRET && !verifyMpSignature(req, MP_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Firma x-signature inválida' });
  }

  const body = req.body || {};
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const topic = String(body.type || body.topic || urlObj.searchParams.get('type') || urlObj.searchParams.get('topic') || '').toLowerCase();
  const resourceId = body.data?.id || urlObj.searchParams.get('data.id') || urlObj.searchParams.get('id');

  if (!resourceId) {
    return res.status(200).json({ ok: true, ignored: 'sin_resource_id' });
  }

  try {
    let reference = '';
    let amount = 0;
    let currency = 'CLP';
    let mappedStatus = null;
    let rawPayload = {};

    if (topic === 'order' || String(resourceId).startsWith('ORD')) {
      // Orders API v1
      const ordRes = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(resourceId)}`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
      });
      if (!ordRes.ok) {
        return res.status(400).json({ error: `Mercado Pago order lookup HTTP ${ordRes.status}` });
      }
      const order = await ordRes.json();
      reference = String(order.external_reference || '').trim();
      currency = String(order.currency_id || order.items?.[0]?.currency_id || 'CLP').toUpperCase();
      amount = Math.round(Number(order.total_paid_amount || order.total_amount || 0));
      const ordStatus = String(order.status || '').toLowerCase();
      const ordDetail = String(order.status_detail || '').toLowerCase();

      if (ordStatus === 'processed' || ordDetail === 'accredited') {
        mappedStatus = 'paid';
      } else if (['failed', 'cancelled', 'expired', 'refunded'].includes(ordStatus)) {
        mappedStatus = 'failed';
      } else {
        return res.status(200).json({ ok: true, status: ordStatus });
      }
      rawPayload = {
        provider: 'mercadopago_orders',
        order_id: order.id,
        status: order.status,
        status_detail: order.status_detail,
        total_amount: order.total_amount
      };
    } else if (!topic || topic === 'payment') {
      // Payments API (compatibilidad)
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(resourceId)}`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
      });
      if (!mpRes.ok) {
        return res.status(400).json({ error: `Mercado Pago payment lookup HTTP ${mpRes.status}` });
      }
      const payment = await mpRes.json();
      reference = String(payment.external_reference || '').trim();
      currency = String(payment.currency_id || 'CLP').toUpperCase();
      amount = Math.round(Number(payment.transaction_amount || 0));
      const mpStatus = String(payment.status || '').toLowerCase();

      if (mpStatus === 'approved') {
        mappedStatus = 'paid';
      } else if (['pending', 'in_process', 'authorized'].includes(mpStatus)) {
        return res.status(200).json({ ok: true, status: mpStatus });
      } else {
        mappedStatus = 'failed';
      }
      rawPayload = {
        provider: 'mercadopago',
        payment_id: payment.id,
        status: payment.status,
        status_detail: payment.status_detail,
        payment_method_id: payment.payment_method_id,
        transaction_amount: payment.transaction_amount
      };
    } else {
      return res.status(200).json({ ok: true, ignored: topic });
    }

    if (!reference.startsWith('RES-') || currency !== 'CLP') {
      return res.status(200).json({ ok: true, ignored: 'referencia_ajena' });
    }

    const sbHeaders = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    };

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirmar_pago_tuu`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        p_reference: reference,
        p_monto_clp: amount,
        p_tuu_status: mappedStatus,
        p_raw_payload: rawPayload
      })
    });

    const rpcData = await rpcRes.json();
    if (!rpcRes.ok) {
      return res.status(400).json({ error: rpcData?.message || 'Error al confirmar pago' });
    }
    return res.status(200).json(rpcData);
  } catch (err) {
    return res.status(500).json({ error: 'Error interno al procesar webhook Mercado Pago' });
  }
}
