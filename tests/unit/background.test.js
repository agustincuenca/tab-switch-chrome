import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import vm from "node:vm";
import { source } from "./helpers.js";

const TABS = [
  { id: 1, windowId: 10, title: "Old", url: "https://old.example/", lastAccessed: 100, active: false },
  { id: 2, windowId: 10, title: "Current", url: "https://current.example/", lastAccessed: 300, active: true },
  { id: 3, windowId: 20, title: "Recent", url: "https://recent.example/", lastAccessed: 200, active: true, pinned: true },
  { id: 4, windowId: 20, title: "", url: "chrome://settings/", lastAccessed: 50, active: false },
];

// Runs background.js in its own context against a mocked `chrome` API.
function loadBackground({ thumbs = {}, lastFocusedActive = 2 } = {}) {
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const store = { ...thumbs };
  const tabs = structuredClone(TABS);

  const chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://ext-id${path}`,
      onMessage: on("runtime.onMessage"),
      onInstalled: on("runtime.onInstalled"),
    },
    tabs: {
      query: vi.fn(async (q) => {
        if (q.lastFocusedWindow) return tabs.filter((t) => t.id === lastFocusedActive);
        if (q.active) return tabs.filter((t) => t.active && t.windowId === q.windowId).map((t) => ({ ...t, status: "complete" }));
        if (q.url) return tabs.filter((t) => t.url.startsWith("http"));
        return structuredClone(tabs);
      }),
      update: vi.fn(async (id) => {
        const tab = tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        return tab;
      }),
      remove: vi.fn(async () => {}),
      captureVisibleTab: vi.fn(async () => "data:image/jpeg;base64,RAW"),
      onActivated: on("tabs.onActivated"),
      onUpdated: on("tabs.onUpdated"),
      onRemoved: on("tabs.onRemoved"),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      update: vi.fn(async () => {}),
      onFocusChanged: on("windows.onFocusChanged"),
    },
    storage: {
      session: {
        get: async () => ({ ...store }),
        set: async (items) => Object.assign(store, items),
        remove: async (k) => delete store[k],
      },
    },
    scripting: { executeScript: vi.fn(async () => []) },
  };

  const canvases = [];
  class OffscreenCanvas {
    constructor(width, height) {
      Object.assign(this, { width, height });
      canvases.push(this);
    }
    getContext() {
      return { drawImage: () => {} };
    }
    async convertToBlob() {
      return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
  }

  const context = vm.createContext({
    chrome,
    URL,
    btoa,
    console,
    OffscreenCanvas,
    fetch: async () => ({ blob: async () => ({}) }),
    createImageBitmap: async () => ({ width: 1920, height: 1200 }),
    // Delegate lazily so vi.useFakeTimers() applies.
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
  });
  vm.runInContext(source("background.js"), context);

  const send = (msg, sender = {}) =>
    new Promise((resolve) => {
      const async = listeners["runtime.onMessage"](msg, sender, resolve);
      if (!async) resolve(undefined);
    }).then((r) => JSON.parse(JSON.stringify(r ?? null)));

  return { chrome, listeners, store, send, canvases };
}

describe("background service worker", () => {
  describe("getTabs", () => {
    it("puts the sender tab first, then the rest by most recent use", async () => {
      const { send } = loadBackground();
      const tabs = await send({ type: "getTabs" }, { tab: { id: 1 } });
      expect(tabs.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    });

    it("uses the active tab of the last focused window when called from the popup", async () => {
      const { send } = loadBackground({ lastFocusedActive: 3 });
      const tabs = await send({ type: "getTabs" });
      expect(tabs.map((t) => t.id)).toEqual([3, 2, 1, 4]);
    });

    it("returns the fields the switcher needs", async () => {
      const { send } = loadBackground({ thumbs: { "thumb:3": "data:image/jpeg;base64,T3" } });
      const tabs = await send({ type: "getTabs" }, { tab: { id: 2 } });
      const recent = tabs.find((t) => t.id === 3);
      expect(recent).toEqual({
        id: 3,
        windowId: 20,
        title: "Recent",
        url: "https://recent.example/",
        favicon: "chrome-extension://ext-id/_favicon/?pageUrl=https%3A%2F%2Frecent.example%2F&size=32",
        thumb: "data:image/jpeg;base64,T3",
        audible: false,
        pinned: true,
      });
      expect(tabs.find((t) => t.id === 1).thumb).toBeNull();
    });

    it("falls back to the URL when a tab has no title", async () => {
      const { send } = loadBackground();
      const tabs = await send({ type: "getTabs" }, { tab: { id: 2 } });
      expect(tabs.find((t) => t.id === 4).title).toBe("chrome://settings/");
    });
  });

  it("activate selects the tab and focuses its window", async () => {
    const { send, chrome } = loadBackground();
    await send({ type: "activate", tabId: 3 });
    expect(chrome.tabs.update).toHaveBeenCalledWith(3, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(20, { focused: true });
  });

  it("close removes the tab", async () => {
    const { send, chrome } = loadBackground();
    await send({ type: "close", tabId: 4 });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(4);
  });

  it("reports errors back to the caller instead of hanging", async () => {
    const { send } = loadBackground();
    expect(await send({ type: "activate", tabId: 999 })).toEqual({ error: "Error: No tab with id: 999" });
  });

  it("ignores unknown messages", async () => {
    const { listeners } = loadBackground();
    expect(listeners["runtime.onMessage"]({ type: "nope" }, {}, () => {})).toBe(false);
    expect(listeners["runtime.onMessage"](undefined, {}, () => {})).toBe(false);
  });

  it("forgets the thumbnail of a closed tab", async () => {
    const { listeners, store } = loadBackground({ thumbs: { "thumb:1": "x", "thumb:2": "y" } });
    await listeners["tabs.onRemoved"](1);
    expect(store).toEqual({ "thumb:2": "y" });
  });

  it("injects the content scripts into already open web pages on install", async () => {
    const { listeners, chrome } = loadBackground();
    await listeners["runtime.onInstalled"]();
    const injected = chrome.scripting.executeScript.mock.calls.map(([arg]) => arg.target.tabId);
    expect(injected).toEqual([1, 2, 3]);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ["switcher-ui.js", "content.js"],
    });
  });

  describe("thumbnails", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("captures and downscales the tab shortly after it is activated", async () => {
      const { listeners, chrome, store, canvases } = loadBackground();
      listeners["tabs.onActivated"]({ tabId: 2, windowId: 10 });
      expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(10, { format: "jpeg", quality: 80 });
      expect(canvases[0]).toMatchObject({ width: 480, height: 300 });
      expect(store["thumb:2"]).toBe("data:image/jpeg;base64,AQID");
    });

    it("debounces rapid tab changes into a single capture", async () => {
      const { listeners, chrome } = loadBackground();
      listeners["tabs.onActivated"]({ tabId: 2, windowId: 10 });
      listeners["tabs.onActivated"]({ tabId: 3, windowId: 20 });
      listeners["windows.onFocusChanged"](20);
      await vi.runAllTimersAsync();
      expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledOnce();
      expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(20, expect.anything());
    });

    it("captures when the active tab finishes loading, not background tabs", async () => {
      const { listeners, chrome } = loadBackground();
      listeners["tabs.onUpdated"](1, { status: "complete" }, { active: false, windowId: 10 });
      listeners["tabs.onUpdated"](2, { status: "loading" }, { active: true, windowId: 10 });
      await vi.runAllTimersAsync();
      expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
      listeners["tabs.onUpdated"](2, { status: "complete" }, { active: true, windowId: 10 });
      await vi.runAllTimersAsync();
      expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledOnce();
    });

    it("ignores focus leaving Chrome", async () => {
      const { listeners, chrome } = loadBackground();
      listeners["windows.onFocusChanged"](-1);
      await vi.runAllTimersAsync();
      expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    });

    it("silently skips pages that can't be captured", async () => {
      const { listeners, chrome, store } = loadBackground();
      chrome.tabs.captureVisibleTab.mockRejectedValue(new Error("Cannot access a chrome:// URL"));
      listeners["tabs.onActivated"]({ tabId: 2, windowId: 10 });
      await vi.runAllTimersAsync();
      expect(store).toEqual({});
    });
  });
});
