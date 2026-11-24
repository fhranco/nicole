// Helper interno (no expuesto como ruta Vercel por prefijo _) para enviar correo de confirmación con enlace a ficha clínica vía Resend.

const SERVICIO_LABELS = {
  consulta_inicial_presencial: 'Consulta Nutricional Inicial (Presencial)',
  consulta_inicial_online: 'Consulta Nutricional Inicial (Online)',
  consulta_inicial: 'Consulta Nutricional Inicial',
  evaluacion_epixlife: 'Evaluación Integral + Epixlife',
  programa_90_dias: 'Programa Integral de 90 Días'
};

const SEDE_LABELS = {
  punta_arenas: 'Punta Arenas · Carlos Condell 065',
  puerto_natales: 'Gira Puerto Natales (Presencial)',
  porvenir: 'Gira Porvenir (Presencial)',
  online: 'Online · Google Meet'
};

function fmtCLP(v) {
  return '$' + Math.round(Number(v || 0)).toLocaleString('es-CL');
}

export async function sendBookingConfirmationEmail({ reference, supabaseUrl, serviceKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !reference || !supabaseUrl || !serviceKey) return { skipped: true };

  const reservaId = String(reference).replace(/^RES-/, '').trim();
  if (!reservaId) return { skipped: true };

  try {
    const sbHeaders = {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    };

    const res = await fetch(
      `${supabaseUrl}/rest/v1/reservas?id=eq.${encodeURIComponent(reservaId)}&select=id,fecha_hora,servicio_slug,sede_slug,modalidad,intake_token,monto_abonado_clp,saldo_pendiente_clp,pacientes(nombre_completo,email)&limit=1`,
      { headers: sbHeaders }
    );
    const rows = await res.json();
    const r = Array.isArray(rows) ? rows[0] : null;
    const patient = Array.isArray(r?.pacientes) ? r.pacientes[0] : r?.pacientes;
    const toEmail = String(patient?.email || '').trim().toLowerCase();
    if (!r || !toEmail || !r.intake_token) return { skipped: true };

    const dt = new Date(r.fecha_hora);
    const fechaTxt = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(dt);
    const horaTxt = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(dt);

    const nombre = (patient?.nombre_completo || 'hola').split(' ')[0];
    const servicio = SERVICIO_LABELS[r.servicio_slug] || r.servicio_slug || 'Consulta Nutricional';
    const lugar = SEDE_LABELS[r.sede_slug] || (r.modalidad === 'online' ? 'Online · Google Meet' : 'Presencial');
    const intakeUrl = `https://www.nicoleborguenson.cl/ingreso-paciente?token=${encodeURIComponent(r.intake_token)}`;
    const fromEmail = process.env.RESEND_FROM || 'Nicole Borguenson <citas@nicoleborguenson.cl>';

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAF9F6;padding:28px 16px;color:#2D3A34;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #D8E4DD;border-radius:20px;overflow:hidden;">
          <div style="background:#2C5240;color:#ffffff;padding:24px 28px;">
            <p style="margin:0;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.85;">Reserva Confirmada</p>
            <h1 style="margin:6px 0 0;font-size:22px;font-weight:600;">¡Nos vemos pronto, ${nombre}!</h1>
          </div>
          <div style="padding:26px 28px;font-size:14px;line-height:1.6;">
            <p style="margin:0 0 14px;">Tu pago fue recibido con éxito y tu hora quedó confirmada con <strong>Nicole Borguenson</strong>:</p>
            <div style="background:#F4F8F6;border:1px solid #D8E4DD;border-radius:14px;padding:16px 18px;margin-bottom:20px;">
              <p style="margin:0 0 6px;"><strong>Servicio:</strong> ${servicio}</p>
              <p style="margin:0 0 6px;"><strong>Fecha:</strong> ${fechaTxt}</p>
              <p style="margin:0 0 6px;"><strong>Hora:</strong> ${horaTxt} hrs</p>
              <p style="margin:0 0 6px;"><strong>Modalidad / Lugar:</strong> ${lugar}</p>
              <p style="margin:0;"><strong>Abonado:</strong> ${fmtCLP(r.monto_abonado_clp)} ${Number(r.saldo_pendiente_clp) > 0 ? `· Saldo en consulta: ${fmtCLP(r.saldo_pendiente_clp)}` : '· Pagado en su totalidad'}</p>
            </div>
            <p style="margin:0 0 16px;"><strong>Paso importante antes de tu sesión:</strong> completa tu Ficha Clínica de Ingreso en el siguiente enlace para que Nicole prepare tu evaluación con anticipación:</p>
            <p style="text-align:center;margin:22px 0;">
              <a href="${intakeUrl}" style="display:inline-block;background:#E07A5F;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:14px;font-size:14px;">
                Completar mi Ficha Clínica
              </a>
            </p>
            <p style="margin:0;font-size:12px;color:#576B60;">Si el botón no abre, copia y pega este enlace en tu navegador:<br/><a href="${intakeUrl}" style="color:#2C5240;">${intakeUrl}</a></p>
          </div>
          <div style="padding:14px 28px;border-top:1px solid #EEF2F0;font-size:11px;color:#6B7280;text-align:center;">
            Nicole Borguenson Fraga · Nutrición Clínica &amp; Integrativa · www.nicoleborguenson.cl
          </div>
        </div>
      </div>
    `;

    const mailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        reply_to: process.env.RESEND_REPLY_TO || 'contacto@nicoleborguenson.cl',
        subject: `Reserva confirmada (${fechaTxt} · ${horaTxt} hrs) - Completa tu ficha`,
        html
      })
    });

    return { ok: mailRes.ok, status: mailRes.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
