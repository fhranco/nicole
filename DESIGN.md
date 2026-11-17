# PATAGONIACOACH — DESIGN SYSTEM APROBADO
## Proyecto: Nutricionista Nicole Borguenson
### Versión 2.0 · Rediseño Visual & Capa de Presentación

---

## 1. FUNDAMENTOS DE MARCA & DIRECCIÓN DE ARTE

- **Estética:** Editorial, delicada, femenina sin estereotipos, contemporánea, cálida y profundamente humana.
- **Tono:** Profesionalismo médico y credibilidad clínica combinados con empatía, cercanía y bienestar sensible.
- **Inspiración:** Diseño editorial de alta gama (revistas de salud integrativa, medicina funcional moderna) con abundante espacio en blanco y fotografía protagonista auténtica.
- **Evitar:** Estética hospitalaria fría, saturación de coral, degradados multicolor sintéticos o elementos infantiles.

---

## 2. SISTEMA CROMÁTICO OFICIAL (INALTERABLE)

| Color | Hex | Rol en el Sistema |
|---|---|---|
| **Blanco** | `#FFFFFF` | **Fondo principal**, superficies limpias, cabecera y navegación, secciones editoriales. |
| **Crema Cálido** | `#F4E8BD` | **Fondos secundarios**, bloques de contenido destacados, secciones cálidas y superficies de apoyo. |
| **Verde Salvia** | `#81B29A` | **Acentos de identidad**, iconografía decorativa, indicadores gráficos, detalles de componentes y fondos sutiles. |
| **Coral** | `#E07A5F` | **Acentos comerciales**, botones principales de agendamiento (CTA), pequeños énfasis editoriales. |
| **Texto Oscuro** | `#292524` | **Textos principales**, títulos, navegación, etiquetas y controles (alto contraste WCAG 2.2 AA). |

### Variaciones Funcionales de Apoyo (Derivadas)
- `verde-salvia-deep`: `#2C5240` (texto salvia sobre blanco con ratio > 4.5:1 para WCAG AA).
- `coral-hover`: `#CC674C` (estado hover activo para botones de alta conversión).
- `crema-surface`: `#FAF6EA` (elevación sutil para tarjetas sobre fondo blanco).
- `borde-sutil`: `rgba(129, 178, 154, 0.2)` o `rgba(41, 37, 36, 0.08)`.

---

## 3. SISTEMA TIPOGRÁFICO OFICIAL

### Fuentes Oficiales
1. **Cormorant Garamond** (Google Fonts: 400, 500, 600, Italic 400, 500)
   - Uso: Títulos principales (H1), títulos de sección (H2), subtítulos (H3), frases destacadas y citas editoriales con cursiva sutil.
2. **Manrope** (Google Fonts: 300, 400, 500, 600, 700)
   - Uso: Párrafos, menús de navegación, botones, formularios, etiquetas, datos de interfaz y badges.

### Jerarquía Tipográfica de Referencia
- **H1 (Hero Principal):** 
  - Desktop: 72–88 px (`clamp(2.75rem, 5.5vw, 5.25rem)`), peso 500, `line-height: 1.05`.
  - Mobile: 44–52 px, peso 500.
  - Cormorant Garamond.
- **H2 (Títulos de Sección):**
  - Desktop: 48–60 px (`clamp(2.125rem, 3.8vw, 3.75rem)`), peso 500, `line-height: 1.15`.
  - Mobile: 34–40 px, peso 500.
  - Cormorant Garamond.
- **H3 (Subtítulos & Bloques):**
  - Desktop: 32–38 px, peso 500–600.
  - Mobile: 26–30 px.
  - Cormorant Garamond.
- **H4 (Títulos de Componentes / Tarjetas):**
  - 20–24 px, peso 600, Manrope.
- **Párrafos (Lectura):**
  - Desktop: 17–18 px, peso 400, `line-height: 1.7–1.8`, ancho de medida 60–70 caracteres (`max-w-prose` / `max-w-2xl`).
  - Mobile: 16 px, peso 400.
  - Manrope.
- **Navegación:**
  - 13–14 px, peso 500, Manrope.
- **Botones & CTA:**
  - 13–14 px, peso 600, Manrope.
- **Microetiquetas & Badges:**
  - 11–12 px, peso 600, Manrope, espaciado moderado (`letter-spacing: 0.06em`).

---

## 4. ICONOGRAFÍA & ASSETS

- **Biblioteca de Iconos:** Lucide (`lucide.createIcons({ attrs: { 'stroke-width': 1.75 } })`). Iconos lineales de grosor consistente, tamaño normalizado y alineación tipográfica perfecta.
- **Fotografía Oficial de Nicole:**
  - `nicole-hero.png` (Retrato principal para Hero).
  - `nicole-consulta.png` (Atención clínica cercana).
  - `nicole-atencion-desk.png` (Consulta y diálogo con paciente).
  - `nicole-consultorio-wide.png` (Espacio físico en Punta Arenas).
  - `nicole-especialista.jpg` (Presentación profesional).
  - `epixlife-preview.jpg` (Visualización de informe de test epigenético).
  - Tratamiento: Luz natural, tonos orgánicos, contraste moderado, encuadres editoriales sin artificios.

---

## 5. REGLAS DE LAYOUT & COMPONENTES

- **Estrategia:** Mobile-first, contenedor principal centrado `max-w-7xl` (1280px), márgenes fluidos `px-4 sm:px-6 lg:px-8`.
- **Header:** Fondo blanco `#FFFFFF` sólido, logotipo y tipografía Manrope, botón de reserva en Coral `#E07A5F`. Menú móvil full screen limpio y accesible.
- **Split Hero:** Composición equilibrada con texto editorial a la izquierda y fotografía oficial a la derecha.
- **Tarjetas:** Fondo blanco `#FFFFFF` o crema `#F4E8BD` suave, bordes delicados `border-[#81B29A]/20`, sombras imperceptibles `shadow-[0_2px_12px_rgba(41,37,36,0.04)]`.
- **Integraciones Intactas:**
  - Agenda en vivo de Reservo.cl (en sección `#reservas` y en modal).
  - Canal directo de WhatsApp con mensajes predefinidos.
  - Test de Bienestar (Quiz) con cálculo interactivo.
  - Popups explicativos de pilares clínicos y reporte Epixlife.
