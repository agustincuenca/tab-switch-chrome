// Service worker: lists tabs in most-recently-used order, keeps a thumbnail
// cache of each tab (captured when it becomes visible) and switches tabs.

const THUMB_WIDTH = 480;
const CAPTURE_DELAY_MS = 600;
const thumbKey = (tabId) => `thumb:${tabId}`;

let captureTimer = null;

function scheduleCapture(windowId) {
  clearTimeout(captureTimer);
  captureTimer = setTimeout(() => captureActive(windowId), CAPTURE_DELAY_MS);
}

async function captureActive(windowId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (!tab || tab.status !== "complete") return;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
    await chrome.storage.session.set({ [thumbKey(tab.id)]: await downscale(dataUrl) });
  } catch {
    // Restricted pages (chrome://, Web Store), minimized windows, rate limits…
  }
}

async function downscale(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
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
  const [tabs, thumbs] = await Promise.all([chrome.tabs.query({}), chrome.storage.session.get(null)]);
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
    thumb: thumbs[thumbKey(tab.id)] || null,
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

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(thumbKey(tabId)));

// Content scripts are not injected into tabs that were already open when the
// extension was installed or reloaded, so inject them by hand.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file://*/*"] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["switcher-ui.js", "content.js"] })
      .catch(() => {});
  }
});
