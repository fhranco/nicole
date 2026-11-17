# Nicole Borguenson — Nutrición Integrativa & Clínica

Sitio web oficial diseñado bajo una estética editorial médica, minimalista y terapéutica.

## 🚀 Cómo ejecutar localmente

Puedes levantar el sitio de cualquiera de las siguientes formas:

### Opción 1: Con npm
```bash
npm run dev
```
Luego abre tu navegador en [http://localhost:8080](http://localhost:8080).

### Opción 2: Con Python
```bash
python3 -m http.server 8080
```
Y accede a [http://localhost:8080](http://localhost:8080).

### Opción 3: Abrir directamente el archivo
Simplemente haz doble clic o abre `index.html` en cualquier navegador web.

---

## 🎨 Características Implementadas
- **Paleta y Tipografía:** Conforme a `DESIGN.md` (EB Garamond, Outfit, terracota `#e07a5f`, verde salvia `#81b29a`, verde bosque `#3d5a49`, base crema `#f4f1de`).
- **Navegación Fluida:** Scroll suave entre secciones (`#inicio`, `#sobre-mi`, `#enfoque`, `#areas-clinicas`, `#motivos`, `#epixlife`, `#testimonios`, `#faq`, `#reservas`, `#contacto`).
- **Contenedor Web de Agendamiento Oficial (#reservas):** Integración directa del sistema de agendamiento en vivo de Reservo.cl en un contenedor web responsivo en la propia página (sin necesidad de API backend), con loader de conexión, recarga en vivo, vista de pantalla completa y asistencia directa por WhatsApp.
- **Modal Interactivo de Reserva:** Acceso rápido y flotante a la agenda oficial sin perder el hilo de navegación.
- **Acordeón Interactivo de FAQs:** Respuestas a dudas clínicas habituales con animación.
- **Diseño 100% Responsivo:** Menú lateral desplegable optimizado para teléfonos y tablets.
