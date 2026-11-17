# F8.4 — Validación de Integración TUU contra Especificación Oficial

## Hallazgo Crítico Corregido en F8.4.5
Al contrastar con la especificación oficial de `developers.tuu.cl`:
1. **Filtrado estricto de parámetros `x_`:** La firma `x_signature` debe calcularse **únicamente sobre claves que comienzan con `x_`** (excluyendo `x_signature`), ordenadas alfabéticamente ASCII, concatenadas `clavevalor` en UTF-8 sin separadores. Se corrigió `verifyTuuSignature()` en [api/tuu-webhook.js](file:///Volumes/SAMSUNG/Sitios%20Web/NICOLE-V2/api/tuu-webhook.js) porque antes incluía cualquier clave presente en el JSON.
2. **Formato de webhook `application/x-www-form-urlencoded`:** TUU envía `x_url_callback` vía `POST` `application/x-www-form-urlencoded`. Se actualizó [dev-server.mjs](file:///Volumes/SAMSUNG/Sitios%20Web/NICOLE-V2/dev-server.mjs) para parsear tanto `application/x-www-form-urlencoded` como `application/json`.

| Prueba | Resultado | Evidencia |
|---|---|---|
| Formato oficial HMAC-SHA256 (`x_*` ordenado + UTF-8 + hex) | **APROBADA** | Verificado con parámetro extra no-`x_` rechazado del hash (`exit 0`). |
| Rechazo de firma inválida (`401`) y moneda no-CLP (`400`) | **APROBADA** | Pruebas unitarias sobre `api/tuu-webhook.js` (`exit 0`). |
| Callback real recibido desde servidores TUU Sandbox | **NO VERIFICADA** | Requiere URL pública (staging) y webhook real de Sandbox. |
