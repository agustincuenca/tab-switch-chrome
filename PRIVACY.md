# Privacy Policy — Tab Switch

**Last updated:** November 27, 2026

Tab Switch is a Chrome extension that lets you switch tabs with ⌥/Alt+Tab through a visual switcher. It works entirely on your own computer.

## Summary

**Tab Switch does not collect, transmit, sell or share any data.** It has no servers, no analytics, no tracking and no third-party services. It makes no network requests.

## What the extension handles, and where it stays

To show the switcher, the extension uses data that never leaves your browser:

- **Your open tabs** (title, address, favicon, and when each was last used), read through Chrome's `tabs` API to build the list. They are not stored, apart from what the next point describes.
- **Thumbnails of the pages you view.** When a tab is shown, the extension takes a small screenshot of it (Chrome's `captureVisibleTab`) and keeps it in the extension's local storage, together with the page's address and the time it was taken, so the switcher can show a preview. At most the 400 most recent thumbnails are kept; older ones are deleted automatically.

That's all. Everything above is stored only in Chrome's local extension storage on your device. It is never synced, uploaded or sent anywhere, and it is deleted when you uninstall the extension.

## What it does NOT do

- It does not read or modify the content of the pages you visit. The script it runs on each page only listens for the ⌥/Alt+Tab shortcut and draws the switcher.
- It does not collect personal information, credentials, financial, health or location data, communications or analytics.
- It does not share data with anyone.

## Permissions

- **tabs** — list your open tabs and switch to or close the one you pick.
- **host permission (all sites)** — needed to show the switcher on any page you're on and to take the visible-tab thumbnails.
- **scripting** — re-insert the switcher into tabs that were already open when the extension was installed or updated.
- **storage / unlimitedStorage** — keep the thumbnails locally (they can exceed Chrome's default 10 MB quota).
- **favicon** — show each tab's icon from Chrome's own favicon cache.

## Changes

Any change to this policy will be published here with a new date.

## Contact

Questions: open an issue at https://github.com/agustincuenca/tab-switch-chrome/issues

---

## Política de privacidad (resumen en español)

Tab Switch **no recoge, envía, vende ni comparte ningún dato**. No tiene servidores, analítica ni servicios de terceros, y no hace peticiones de red. Para mostrar el selector lee tus pestañas abiertas y guarda, solo en el almacenamiento local de la extensión en tu equipo, miniaturas de las páginas que ves junto a su dirección y la hora (máximo las 400 más recientes). Nada sale de tu navegador y todo se borra al desinstalar la extensión.
