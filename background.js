// Service worker: lists tabs in most-recently-used order, keeps a thumbnail
// cache of each tab (captured when it becomes visible) and switches tabs.
//
// Chrome can only screenshot the visible tab, so thumbnails are kept in
// storage.local by page URL: they survive extension reloads and browser
// restarts, and the oldest are pruned past MAX_THUMBS. storage.session maps
// each open tab to the URL of its last capture, so a tab whose URL changed
// without a new capture (single-page apps) still shows its last screenshot.

const THUMB_WIDTH = 640;
const CAPTURE_DELAY_MS = 600;
const MAX_THUMBS = 400;
const INDEX_KEY = "thumbIndex"; // { [url]: capture time }
const thumbKey = (url) => `thumb:${url}`;
const lastCaptureKey = (tabId) => `lastCapture:${tabId}`;

// Chrome allows two captureVisibleTab calls per second.
const MIN_CAPTURE_INTERVAL_MS = 550;

let captureTimer = null;
let lastCaptureAt = 0;

function scheduleCapture(windowId) {
  clearTimeout(captureTimer);
  captureTimer = setTimeout(() => captureActive(windowId), CAPTURE_DELAY_MS);
}

async function captureActive(windowId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.status === "complete") await (await grab(tab));
  } catch {
    // Restricted pages (chrome://, Web Store), minimized windows, rate limits…
  }
}

// Screenshots the visible tab of `tab`'s window. Resolves once the frame is
// grabbed (so the page may change from then on) with a promise for the
// downscaled thumbnail being saved, or null when throttled.
async function grab(tab) {
  if (Date.now() - lastCaptureAt < MIN_CAPTURE_INTERVAL_MS) return null;
  // The window must still be showing this tab, before and after the
  // screenshot; otherwise we'd file another tab's picture under its URL.
  const isShowing = async () => (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0]?.id === tab.id;
  if (!(await isShowing())) return null;
  lastCaptureAt = Date.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
  if (!(await isShowing())) return null;
  return downscale(dataUrl)
    .then((thumb) => saveThumb(tab, thumb))
    .catch(() => {});
}

// Requested by the page itself: when Alt goes down (about to leave the tab)
// and periodically while it's being looked at, so thumbnails stay current.
async function snapshot(tab) {
  if (!tab?.active) return;
  try {
    await grab(tab);
  } catch {
    // Same as captureActive.
  }
}

async function saveThumb(tab, thumb) {
  const { [INDEX_KEY]: index = {} } = await chrome.storage.local.get(INDEX_KEY);
  index[tab.url] = Date.now();
  const stale = Object.keys(index)
    .sort((a, b) => index[b] - index[a])
    .slice(MAX_THUMBS);
  stale.forEach((url) => delete index[url]);
  await chrome.storage.local.set({ [thumbKey(tab.url)]: thumb, [INDEX_KEY]: index });
  if (stale.length) await chrome.storage.local.remove(stale.map(thumbKey));
  await chrome.storage.session.set({ [lastCaptureKey(tab.id)]: tab.url });
}

async function getThumbs(tabs) {
  const lastCaptures = await chrome.storage.session.get(tabs.map((tab) => lastCaptureKey(tab.id)));
  const urls = new Set(tabs.flatMap((tab) => [tab.url, lastCaptures[lastCaptureKey(tab.id)]]).filter(Boolean));
  const thumbs = await chrome.storage.local.get([...urls].map(thumbKey));
  return (tab) => thumbs[thumbKey(tab.url)] || thumbs[thumbKey(lastCaptures[lastCaptureKey(tab.id)])] || null;
}

async function downscale(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

function faviconUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl || "");
  url.searchParams.set("size", "32");
  return url.toString();
}

async function getTabs(currentTabId) {
  const tabs = await chrome.tabs.query({});
  const thumbOf = await getThumbs(tabs);
  if (currentTabId == null) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    currentTabId = active?.id;
  }
  tabs.sort((a, b) => {
    if (a.id === currentTabId) return -1;
    if (b.id === currentTabId) return 1;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
  return tabs.map((tab) => ({
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.url || "Nueva pestaña",
    url: tab.url || "",
    favicon: faviconUrl(tab.url),
    thumb: thumbOf(tab),
    audible: !!tab.audible,
    pinned: !!tab.pinned,
  }));
}

async function activateTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
}

// Key events caught inside an iframe are forwarded to the tab's top frame,
// which owns the overlay. Relaying through here (instead of postMessage)
// means a web page can't fake them.
async function relayKey(tabId, event) {
  await chrome.tabs.sendMessage(tabId, { type: "relayedKey", event }, { frameId: 0 });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    getTabs: () => getTabs(sender.tab?.id),
    activate: () => activateTab(msg.tabId),
    close: () => closeTab(msg.tabId),
    relayKey: () => relayKey(sender.tab?.id, msg.event),
    snapshot: () => snapshot(sender.tab),
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler().then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true;
});

chrome.tabs.onActivated.addListener(({ windowId }) => scheduleCapture(windowId));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab.active) scheduleCapture(tab.windowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) scheduleCapture(windowId);
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(lastCaptureKey(tabId)));

// Content scripts are not injected into tabs that were already open when the
// extension was installed or reloaded, so inject them by hand.
chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.remove("debugLog"); // left behind by a debug build
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file://*/*"] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["switcher-ui.js", "content.js"] })
      .catch(() => {});
  }
});
