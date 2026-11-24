// Vercel Serverless Function: Sincronización manual de paciente con Plan Integral hacia el proyecto Supabase "raiz"
// Mantiene aislamiento total: lee JWT de Nicole (pacientes), valida es_admin_clinica(), y escribe en raiz con SERVICE_ROLE_KEY.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    RAIZ_SUPABASE_URL,
    RAIZ_SERVICE_ROLE_KEY
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Faltan variables de Supabase principal en el servidor.' });
  }
  if (!RAIZ_SUPABASE_URL || !RAIZ_SERVICE_ROLE_KEY) {
    return res.status(503).json({
      error: 'Falta configurar RAIZ_SUPABASE_URL y RAIZ_SERVICE_ROLE_KEY en Vercel para activar la sincronización con App Raíz.'
    });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sesión no autenticada.' });
  }

  // 1. Verificar que quien llama es Nicole / equipo clínico autorizado en "pacientes"
  try {
    const verifyRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/es_admin_clinica`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': authHeader
      },
      body: '{}'
    });
    const isAdmin = await verifyRes.json();
    if (!verifyRes.ok || isAdmin !== true) {
      return res.status(403).json({ error: 'Solo el equipo clínico autorizado puede sincronizar pacientes con App Raíz.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Error al verificar permisos clínicos.' });
  }

  const { action = 'activate', patient = {}, anthropometry = {}, pauta = {}, tea = {}, fecha } = req.body || {};
  const cleanEmail = String(patient.email || '').trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'El paciente debe tener un correo válido para vincularlo a la App Raíz.' });
  }

  const raizHeaders = {
    'Content-Type': 'application/json',
    'apikey': RAIZ_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${RAIZ_SERVICE_ROLE_KEY}`
  };

  async function raizFetch(path, options = {}) {
    const r = await fetch(`${RAIZ_SUPABASE_URL}${path}`, {
      ...options,
      headers: { ...raizHeaders, ...(options.headers || {}) }
    });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!r.ok) {
      throw new Error((data && (data.message || data.error || data.hint)) || `Error Raíz (${r.status})`);
    }
    return data;
  }

  try {
    // 2. Obtener org_id y therapist_id base en Raíz
    const orgs = await raizFetch('/rest/v1/organizations?select=id&limit=1');
    const orgId = orgs?.[0]?.id;
    if (!orgId) throw new Error('No se encontró una organización en Raíz.');

    const therapists = await raizFetch(`/rest/v1/therapists?org_id=eq.${orgId}&select=id&limit=1`);
    const therapistId = therapists?.[0]?.id || null;

    // 3. Buscar paciente existente por email en Raíz
    const existingPatients = await raizFetch(
      `/rest/v1/patients?org_id=eq.${orgId}&email=ilike.${encodeURIComponent(cleanEmail)}&select=id,status,portal_user_id&limit=1`
    );
    let raizPatient = existingPatients?.[0] || null;

    // Acción: Pausar acceso a App Raíz
    if (action === 'pause') {
      if (!raizPatient) {
        return res.status(200).json({ ok: true, status: 'inactive', message: 'El paciente no tenía acceso activo en App Raíz.' });
      }
      await raizFetch(`/rest/v1/patients?id=eq.${raizPatient.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'inactive', updated_at: new Date().toISOString() })
      });
      return res.status(200).json({ ok: true, status: 'inactive', raiz_patient_id: raizPatient.id });
    }

    // 4. Activar / Crear paciente en Raíz
    const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(patient.birth_date || '')) ? patient.birth_date : null;
    const clinicalProfile = tea?.activo ? 'TEA / Selectividad Alimentaria' : 'Nutrición Clínica Integrativa';
    const patientPayload = {
      org_id: orgId,
      therapist_id: therapistId,
      name: String(patient.name || 'Paciente').trim(),
      email: cleanEmail,
      phone: patient.phone ? String(patient.phone).trim() : null,
      birth_date: birthDate,
      main_goal: patient.main_goal ? String(patient.main_goal).trim() : null,
      clinical_profile: clinicalProfile,
      status: 'active',
      updated_at: new Date().toISOString()
    };

    if (raizPatient) {
      await raizFetch(`/rest/v1/patients?id=eq.${raizPatient.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patientPayload)
      });
    } else {
      const created = await raizFetch('/rest/v1/patients', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...patientPayload, joined_at: new Date().toISOString().slice(0, 10) })
      });
      raizPatient = created?.[0];
    }

    if (!raizPatient?.id) throw new Error('No se pudo crear o recuperar el paciente en Raíz.');

    // 5. Sincronizar Medición Antropométrica si hay datos
    const num = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) ? Number(v) : null;
    const w = num(anthropometry.peso);
    const h = num(anthropometry.talla);
    const bmi = num(anthropometry.imc);
    const waist = num(anthropometry.cintura);
    const fat = num(anthropometry.grasa_pct);
    const muscle = num(anthropometry.musculo_pct);
    const measuredAt = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : new Date().toISOString().slice(0, 10);

    if (w !== null || h !== null || waist !== null || fat !== null || muscle !== null) {
      await raizFetch('/rest/v1/measurements', {
        method: 'POST',
        body: JSON.stringify({
          org_id: orgId,
          patient_id: raizPatient.id,
          measured_at: measuredAt,
          weight_kg: w,
          height_cm: h,
          bmi,
          waist_cm: waist,
          body_fat_pct: fat,
          skeletal_muscle_kg: muscle,
          method: 'Consulta Nicole Borguenson'
        })
      });
    }

    // 6. Publicar Plan Vivo (plan_versions + plan_items) si hay pauta o TEA activo
    const itemsToCreate = [];
    const pushItem = (key, label, instruction, category, frequency, unit = 'indicación') => {
      const clean = String(instruction || '').trim();
      if (!clean) return;
      itemsToCreate.push({
        org_id: orgId,
        patient_id: raizPatient.id,
        item_key: key,
        label,
        description: clean.slice(0, 120),
        instruction: clean,
        target: 1,
        unit,
        category,
        frequency,
        tracking: 'manual',
        patient_visible: true
      });
    };

    pushItem('desayuno', 'Desayuno', pauta.desayuno, 'nutrition', 'daily', 'comida');
    pushItem('colacion_am', 'Colación AM', pauta.colacion_am, 'nutrition', 'daily', 'comida');
    pushItem('almuerzo', 'Almuerzo', pauta.almuerzo, 'nutrition', 'daily', 'comida');
    pushItem('colacion_pm', 'Once / Colación PM', pauta.colacion_pm, 'nutrition', 'daily', 'comida');
    pushItem('cena', 'Cena', pauta.cena, 'nutrition', 'daily', 'comida');
    pushItem('priorizar', 'Alimentos a priorizar', pauta.priorizar, 'nutrition', 'daily', 'guía');
    pushItem('limitar', 'Limitar o pausar temporalmente', pauta.limitar, 'nutrition', 'daily', 'guía');
    pushItem('suplementos', 'Suplementación y horarios', pauta.suplementos, 'supplement', 'daily', 'dosis');
    pushItem('hidratacion', 'Hidratación y hábitos', pauta.hidratacion, 'hydration', 'daily', 'hábito');

    if (tea?.activo) {
      pushItem('tea_seguros', 'Alimentos seguros (TEA)', tea.alimentos_seguros, 'nutrition', 'daily', 'guía');
      pushItem('tea_puente', 'Puente sensorial (Food Chaining)', tea.puente_sensorial, 'other', 'as_needed', 'exposición');
      pushItem('tea_estrategia', 'Estrategia en casa (TEA)', tea.estrategia_familia, 'other', 'daily', 'estrategia');
    }

    if (itemsToCreate.length > 0) {
      // Asegurar ciclo activo (cumpliendo NOT NULL: number, start_date, end_date, review_date, goal)
      const activeCycles = await raizFetch(
        `/rest/v1/cycles?org_id=eq.${orgId}&patient_id=eq.${raizPatient.id}&status=eq.active&select=id&limit=1`
      );
      let cycleId = activeCycles?.[0]?.id || null;
      if (!cycleId) {
        const startD = new Date(`${measuredAt}T12:00:00Z`);
        const addDays = (d, days) => new Date(d.getTime() + days * 86400000).toISOString().slice(0, 10);
        const allCycles = await raizFetch(
          `/rest/v1/cycles?org_id=eq.${orgId}&patient_id=eq.${raizPatient.id}&select=number&order=number.desc&limit=1`
        );
        const nextNum = (allCycles?.[0]?.number || 0) + 1;
        const newCycle = await raizFetch('/rest/v1/cycles', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            org_id: orgId,
            patient_id: raizPatient.id,
            number: nextNum,
            status: 'active',
            start_date: measuredAt,
            review_date: addDays(startD, 30),
            end_date: addDays(startD, 90),
            goal: patient.main_goal ? String(patient.main_goal).trim() : 'Plan Nutricional Integrativo'
          })
        });
        cycleId = newCycle?.[0]?.id || null;
      }

      // Archivar versiones anteriores publicadas y calcular siguiente número de versión
      const prevVersions = await raizFetch(
        `/rest/v1/plan_versions?patient_id=eq.${raizPatient.id}&select=id,version,status&order=version.desc&limit=5`
      );
      const nextVersion = (prevVersions?.[0]?.version || 0) + 1;
      for (const pv of (prevVersions || [])) {
        if (pv.status === 'published') {
          await raizFetch(`/rest/v1/plan_versions?id=eq.${pv.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'archived' })
          });
        }
      }

      const createdPlan = await raizFetch('/rest/v1/plan_versions', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          org_id: orgId,
          patient_id: raizPatient.id,
          cycle_id: cycleId,
          version: nextVersion,
          status: 'published',
          focus: tea?.activo ? 'Pauta Nutricional + Perfil TEA' : 'Pauta Nutricional Integrativa',
          change_reason: `Sincronizado desde consulta (${measuredAt})`,
          published_at: new Date().toISOString()
        })
      });
      const planVersionId = createdPlan?.[0]?.id;
      if (planVersionId) {
        await raizFetch('/rest/v1/plan_items', {
          method: 'POST',
          body: JSON.stringify(itemsToCreate.map((it) => ({ ...it, plan_version_id: planVersionId })))
        });
      }
    }

    return res.status(200).json({
      ok: true,
      status: 'active',
      raiz_patient_id: raizPatient.id,
      synced_items: itemsToCreate.length
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Error al sincronizar con App Raíz.' });
  }
}
