# Tab Switch

Extensión de Chrome para cambiar de pestaña con **Alt+Tab** (⌥+Tab en macOS), con un selector visual estilo [AltTab](https://alt-tab-macos.netlify.app/) que muestra miniaturas de todas las pestañas de Chrome (de todas las ventanas), ordenadas por uso reciente.

## Instalación

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige esta carpeta.

## Uso

| Tecla | Acción |
| --- | --- |
| Mantén ⌥/Alt + pulsa Tab | Abre el selector y avanza a la siguiente pestaña |
| ⌥/Alt + Shift + Tab | Retrocede |
| ← → ↑ ↓ | Moverse por la cuadrícula |
| Soltar ⌥/Alt | Cambia a la pestaña seleccionada |
| W (con ⌥/Alt pulsado) | Cierra la pestaña seleccionada |
| Esc | Cancela |
| Ratón | Pasar por encima selecciona, clic cambia |

Un toque rápido de ⌥+Tab salta directamente a la última pestaña usada.

**Alt+Q** abre el mismo selector como popup de la extensión (navega con Tab/flechas, Enter para cambiar). Puedes cambiar ese atajo en `chrome://extensions/shortcuts`.

## Limitaciones

- Chrome no permite registrar Alt+Tab como atajo global de extensión, así que ⌥+Tab se captura desde un script dentro de cada página. **No funciona** en páginas `chrome://`, la Chrome Web Store, la página de nueva pestaña ni cuando el foco está en la barra de direcciones: ahí usa **Alt+Q**.
- En Windows/Linux, Alt+Tab lo captura el sistema operativo antes que Chrome; esta extensión está pensada para macOS (donde ⌥+Tab está libre).
- Las miniaturas se capturan cuando una pestaña se muestra (`captureVisibleTab`), así que las pestañas que no has visitado desde que se cargó la extensión aparecen con su favicon en lugar de miniatura.

## Archivos

- `background.js` — service worker: lista de pestañas por uso reciente, captura de miniaturas y cambio/cierre de pestañas.
- `switcher-ui.js` — interfaz del selector (Shadow DOM), compartida por el overlay y el popup.
- `content.js` — captura ⌥+Tab en las páginas y muestra el overlay.
- `popup.html` / `popup.js` — selector de respaldo para Alt+Q.

## Tests

```bash
npm install
npx playwright install chromium   # solo la primera vez
npm test          # tests unitarios (Vitest + jsdom)
npm run test:e2e  # tests E2E: carga la extensión en Chromium con Playwright
```

- `tests/unit/` — UI del selector, content script (teclado, toque rápido, cancelación…) y service worker con la API `chrome` simulada.
- `tests/e2e/` — abre pestañas reales servidas por un servidor HTTP local y comprueba que ⌥+Tab, Esc, W, el popup y las miniaturas funcionan.
