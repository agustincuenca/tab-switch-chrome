# Chrome Web Store — Tab Switch (v1.0.0, primera publicación)

Texto listo para copiar y pegar en cada campo del Developer Dashboard, en el orden en que aparecen.

- **Paquete:** `dist/TabSwitch-v1.0.0.zip` (se genera con `scripts/build-zip.sh`)
- **Capturas:** `store/screenshots/` (se regeneran con `node scripts/store-screenshots.mjs`)
- **Promo pequeña:** `store/promo-small-440x280.png`

La interfaz de la extensión está en español, así que la ficha va en español. Los textos para los revisores (justificaciones) van en inglés.

---

## 0. Subir el paquete

**Items → New item → Upload** → `dist/TabSwitch-v1.0.0.zip`

---

## 1. Store listing → Product details

### Title (lo coge del manifest)
```
Tab Switch
```

### Summary (lo coge del manifest, máx. 132)
```
Cambia de pestaña con ⌥+Tab, como en el Mac: un selector visual con miniaturas de todas tus pestañas de Chrome.
```

### Description
```
Tab Switch lleva a Chrome el gesto que ya usas para cambiar de aplicación: mantén ⌥ (Alt), pulsa Tab y elige pestaña en un selector visual con miniaturas de todas tus pestañas abiertas, de todas las ventanas, ordenadas por uso reciente.


CÓMO SE USA

• Mantén ⌥/Alt y pulsa Tab → se abre el selector y avanza a la siguiente pestaña
• ⌥/Alt + Shift + Tab → retrocede
• Flechas ← → ↑ ↓ → muévete por la cuadrícula
• Suelta ⌥/Alt → vas a la pestaña seleccionada
• W (con ⌥/Alt pulsado) → cierra la pestaña seleccionada
• Esc → cancela
• Ratón → pasar por encima selecciona, clic cambia

Un toque rápido de ⌥+Tab salta directamente a la última pestaña que usaste, como en el sistema.


LO QUE TIENE

🖼  Miniaturas reales de cada pestaña, no solo títulos
🕘  Orden por uso reciente, entre todas tus ventanas
🌗  Modo claro y oscuro, según tu sistema
⚡  Toque rápido para saltar a la pestaña anterior
🧩  Funciona también con el foco dentro de iframes y editores incrustados
⌨️  Alt+Q abre el mismo selector como ventana de la extensión, para páginas donde ⌥+Tab no llega (configurable en chrome://extensions/shortcuts)


LIMITACIONES

• Chrome no deja a las extensiones usar Alt+Tab como atajo global, así que se captura dentro de cada página. En páginas chrome://, la Chrome Web Store, la nueva pestaña o con el foco en la barra de direcciones, usa Alt+Q.
• Pensada para macOS, donde ⌥+Tab está libre. En Windows y Linux el sistema se queda Alt+Tab; ahí usa Alt+Q.
• Las pestañas que aún no has visto desde que instalaste la extensión aparecen con su icono hasta que las visitas.


PRIVACIDAD

• No recoge ni envía ningún dato. Sin servidores, sin analítica, sin terceros, sin peticiones de red.
• Las miniaturas se guardan solo en tu equipo, en el almacenamiento local de la extensión (máximo 400, las más antiguas se borran solas) y se eliminan al desinstalarla.
• No lee ni modifica el contenido de las páginas: solo escucha el atajo y dibuja el selector.
```

### Category
```
Productivity → Tools
```
(si solo te deja una: **Tools**)

### Language
```
Español
```

---

## 2. Graphic assets

| Campo | Archivo |
| --- | --- |
| Store icon (128×128) | `icons/icon128.png` |
| Screenshots (1280×800) | `store/screenshots/01-switcher-light.png`, `store/screenshots/02-switcher-dark.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |
| Marquee (1400×560) | opcional, se puede dejar vacío |

---

## 3. Additional fields

| Campo | Valor |
| --- | --- |
| Official URL | dejar en *None* |
| Homepage URL | `https://github.com/agustincuenca/tab-switch-chrome` |
| Support URL | `https://github.com/agustincuenca/tab-switch-chrome/issues` |
| Mature content | No |

---

## 4. Privacy (pestaña «Privacy practices»)

### Single purpose description
```
Tab Switch lets the user switch between their open Chrome tabs with ⌥/Alt+Tab, through a visual switcher that shows a thumbnail of each tab, ordered by most recent use. That is its only purpose.
```

### Permission justifications

**tabs**
```
Needed to list the user's open tabs (title, URL, favicon, last-used time) across all windows so the switcher can show them in most-recently-used order, and to switch to or close the tab the user picks.
```

**Host permission (<all_urls>)**
```
The switcher is opened with the ⌥/Alt+Tab shortcut on whatever page the user is on. Chrome does not let extensions register Alt+Tab as a command, so a content script on every page listens for that shortcut and draws the switcher overlay; it does not read or change page content. The host permission is also required by chrome.tabs.captureVisibleTab, which takes the thumbnail of the tab the user is looking at. Nothing is sent anywhere.
```

**scripting**
```
Used only in runtime.onInstalled to inject the extension's own content script into tabs that were already open when the extension was installed or updated, so the shortcut works in them without the user reloading every tab.
```

**storage**
```
Stores the tab thumbnails locally (chrome.storage.local) keyed by page URL with a capture timestamp, capped at the 400 most recent, plus a per-tab pointer in chrome.storage.session. Nothing is synced or transmitted.
```

**unlimitedStorage**
```
Each thumbnail is a 640px-wide JPEG of tens of kilobytes. Keeping up to 400 of them can exceed the default 10 MB chrome.storage.local quota, so unlimitedStorage prevents thumbnails from silently failing to save. The extension prunes old thumbnails itself, beyond 400.
```

**favicon**
```
Shows each tab's icon in the switcher from Chrome's own favicon cache (chrome-extension://<id>/_favicon/), without fetching icons from the network.
```

**Remote code**
```
No, I am not using remote code.
```

### Data usage

Ninguna casilla de datos marcada: la extensión no recoge nada. En la política de Chrome, «recoger» es sacar datos del dispositivo, y aquí nada sale: las miniaturas y sus URLs se quedan en el almacenamiento local de la extensión. Es el mismo criterio que en Priorities for Basecamp. Si un revisor pregunta, la respuesta está en las justificaciones de `storage` y del host.

Compliance (marcar las tres):
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL
```
https://github.com/agustincuenca/tab-switch-chrome/blob/main/PRIVACY.md
```

---

## 5. Distribution

| Campo | Valor |
| --- | --- |
| Payments | Free of charge |
| Visibility | Public (o *Unlisted* si prefieres que solo entre quien tenga el enlace) |
| Regions | All regions |

---

## 6. Enviar a revisión

**Submit for review.** Con `<all_urls>` la revisión suele ser más lenta (revisión en profundidad). Es normal; las justificaciones de arriba explican por qué hace falta.
