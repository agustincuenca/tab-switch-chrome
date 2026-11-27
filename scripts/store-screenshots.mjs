// Takes the Chrome Web Store screenshots (1280x800) with the real extension
// loaded in Playwright's Chromium, over a handful of mock pages served locally.
// Usage: node scripts/store-screenshots.mjs  → writes store/screenshots/*.jpg

import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "store/screenshots");
mkdirSync(outDir, { recursive: true });

const PAGES = [
  { slug: "mail", title: "Bandeja de entrada (12)", color: "#d93025", emoji: "✉️", kind: "list" },
  { slug: "docs", title: "Plan de lanzamiento — Documento", color: "#1a73e8", emoji: "📄", kind: "doc" },
  { slug: "calendar", title: "Calendario — Semana 48", color: "#188038", emoji: "📅", kind: "grid" },
  { slug: "board", title: "Roadmap Q1 · Tablero", color: "#8430ce", emoji: "🗂️", kind: "board" },
  { slug: "sheet", title: "Presupuesto 2027 — Hoja de cálculo", color: "#0b8043", emoji: "📊", kind: "grid" },
  { slug: "news", title: "Noticias de tecnología", color: "#e37400", emoji: "📰", kind: "doc" },
  { slug: "design", title: "Revisión de diseño — Prototipo", color: "#c5221f", emoji: "🎨", kind: "board" },
  { slug: "chat", title: "Equipo · Chat", color: "#12857a", emoji: "💬", kind: "list" },
];

function body(p) {
  const bar = (w, c = "#dadce0") => `<div style="height:12px;width:${w}%;background:${c};border-radius:6px;margin:12px 0"></div>`;
  const card = (h, inner = "") =>
    `<div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.15);padding:16px;height:${h}px">${inner}</div>`;
  const content = {
    list: Array.from({ length: 9 }, (_, i) =>
      `<div style="display:flex;gap:14px;align-items:center;background:#fff;border-bottom:1px solid #eee;padding:14px 20px">
        <div style="width:36px;height:36px;border-radius:50%;background:hsl(${i * 47},60%,60%)"></div>
        <div style="flex:1">${bar(30 + ((i * 13) % 40), "#5f6368")}${bar(50 + ((i * 7) % 40))}</div></div>`).join(""),
    doc: `<div style="max-width:760px;margin:0 auto;background:#fff;padding:48px 64px;box-shadow:0 1px 3px rgba(0,0,0,.15);min-height:900px">
        ${bar(60, p.color)}${Array.from({ length: 14 }, (_, i) => bar(70 + ((i * 17) % 30))).join("")}</div>`,
    grid: `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px">${Array.from({ length: 30 }, (_, i) =>
      card(80, i % 4 === 0 ? bar(70, p.color) : bar(50))).join("")}</div>`,
    board: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">${["Ideas", "Por hacer", "En curso", "Hecho"].map(
      (col, c) => `<div style="background:#ebecf0;border-radius:12px;padding:12px"><b style="font:600 15px system-ui;color:#333">${col}</b>
        ${Array.from({ length: 3 + (c % 2) }, (_, i) => `<div style="margin-top:10px">${card(70, bar(60 + i * 10, i === 0 ? p.color : "#dadce0") + bar(40))}</div>`).join("")}</div>`).join("")}</div>`,
  }[p.kind];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${p.emoji}</text></svg>">
    </head><body style="margin:0;font-family:system-ui;background:#f1f3f4">
    <div style="height:64px;background:${p.color};display:flex;align-items:center;padding:0 24px;color:#fff;font:600 20px system-ui">${p.emoji}&nbsp; ${p.title}</div>
    <div style="padding:24px">${content}</div></body></html>`;
}

const server = createServer((req, res) => {
  const page = PAGES.find((p) => req.headers.host?.startsWith(`${p.slug}.`));
  res.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  res.end(page ? body(page) : "");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
// Every *.example.com host resolves to the local server, so the switcher shows
// tidy URLs instead of 127.0.0.1:<port>.
const url = (slug) => `http://${slug}.example.com/`;

async function shoot(colorScheme, file, presses) {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme,
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      `--host-resolver-rules=MAP *.example.com 127.0.0.1:${server.address().port}`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  let last;
  for (const p of PAGES) {
    const opened = context.waitForEvent("page");
    await worker.evaluate((u) => chrome.tabs.create({ url: u }), url(p.slug));
    last = await opened;
    await last.waitForLoadState("load");
    await last.waitForTimeout(1300); // let the extension capture the thumbnail
  }
  // Close the blank tab Playwright starts with.
  for (const pg of context.pages()) if (pg.url() === "about:blank") await pg.close();
  await last.bringToFront();
  await last.keyboard.down("Alt");
  for (let i = 0; i < presses; i++) await last.keyboard.press("Tab");
  await last.locator("tab-switch-overlay").waitFor({ state: "attached" });
  await last.waitForTimeout(500);
  // JPEG: the store wants images without an alpha channel.
  await last.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 95 });
  await last.keyboard.up("Alt");
  await context.close();
}

await shoot("light", "01-switcher-light.jpg", 1);
await shoot("dark", "02-switcher-dark.jpg", 3);
server.close();
console.log(`Screenshots in ${path.relative(root, outDir)}/`);
