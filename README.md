# Tab Switch

Extensión de Chrome para cambiar de pestaña como cambias de aplicación: **⌥+Tab** en macOS y **Alt+W** en Windows y Linux. Muestra un selector visual con miniaturas de todas las pestañas de Chrome (de todas las ventanas), ordenadas por uso reciente.

## Instalación

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige esta carpeta.

## Uso

Los dos atajos funcionan igual: mantén Alt (⌥), avanza con la otra tecla y suelta Alt para ir a la pestaña seleccionada.

| Tecla | Acción |
| --- | --- |
| Mantén ⌥ + pulsa Tab (Mac) | Abre el selector y avanza a la siguiente pestaña |
| Mantén Alt + pulsa W (Windows, Linux; también en Mac) | Abre el mismo selector; cada W avanza |
| Tab o W (con Alt pulsado) | Siguiente pestaña |
| Shift+Tab o Q (con Alt pulsado) | Pestaña anterior |
| ← → ↑ ↓ | Moverse por la cuadrícula |
| Soltar Alt | Cambia a la pestaña seleccionada |
| X (con Alt pulsado) | Cierra la pestaña seleccionada |
| Enter | Cambia a la pestaña seleccionada |
| Esc | Cancela |
| Ratón | Pasar por encima selecciona, clic cambia |

Un toque rápido de ⌥+Tab o de Alt+W salta directamente a la última pestaña usada.

Alt+W es un atajo de extensión: la página no lo recibe, así que el service worker avisa al content script en cada pulsación. En páginas `chrome://`, la Web Store, la nueva pestaña o con el foco en la barra de direcciones, el selector sale como ventana de la extensión junto a su icono.

Alt+W se puede cambiar en `chrome://extensions/shortcuts`. Si vienes de una versión anterior, Chrome conserva el atajo antiguo en «Activar la extensión»: bórralo ahí y asigna Alt+W a «Abrir el selector de pestañas».

## Limitaciones

- Chrome no permite registrar Alt+Tab como atajo de extensión, así que ⌥+Tab se captura desde un script dentro de cada página. No funciona en páginas `chrome://`, la Chrome Web Store, la página de nueva pestaña ni cuando el foco está en la barra de direcciones: ahí usa **Alt+W**, que abre el selector como ventana de la extensión.
- En Windows y Linux, Alt+Tab lo captura el sistema operativo antes que Chrome: usa **Alt+W**.
- Las miniaturas se capturan cuando una pestaña se muestra (`captureVisibleTab`), así que las pestañas que no has visitado desde que se cargó la extensión aparecen con su favicon en lugar de miniatura.

## Archivos

- `background.js` — service worker: lista de pestañas por uso reciente, captura de miniaturas y cambio/cierre de pestañas.
- `switcher-ui.js` — interfaz del selector (Shadow DOM), compartida por el overlay y el popup.
- `content.js` — captura ⌥+Tab en las páginas y muestra el overlay.
- `popup.html` / `popup.js` — el selector como ventana de la extensión, para donde la página no puede mostrarlo (páginas `chrome://`, barra de direcciones con el foco).

## Tests

```bash
npm install
npx playwright install chromium   # solo la primera vez
npm test          # tests unitarios (Vitest + jsdom)
npm run test:e2e  # tests E2E: carga la extensión en Chromium con Playwright
```

- `tests/unit/` — UI del selector, content script (teclado, toque rápido, cancelación…) y service worker con la API `chrome` simulada.
- `tests/e2e/` — abre pestañas reales servidas por un servidor HTTP local y comprueba que ⌥+Tab, Esc, X, el popup (W/Q y soltar Alt) y las miniaturas funcionan.
