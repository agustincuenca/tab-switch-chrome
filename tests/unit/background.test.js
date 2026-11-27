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
// A chrome.storage area backed by a plain object.
function storageArea(initial = {}) {
  const data = { ...initial };
  const pick = (keys) =>
    keys == null ? { ...data } : Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, data[k]]));
  return {
    data,
    get: async (keys) => pick(keys),
    set: async (items) => Object.assign(data, items),
    remove: async (keys) => [keys].flat().forEach((k) => delete data[k]),
  };
}

function loadBackground({ local = {}, session = {}, lastFocusedActive = 2, popupOpen = false, pageReply } = {}) {
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const localArea = storageArea(local);
  const sessionArea = storageArea(session);
  const tabs = structuredClone(TABS);

  const chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://ext-id${path}`,
      getContexts: vi.fn(async () => (popupOpen ? [{ contextType: "POPUP" }] : [])),
      sendMessage: vi.fn(async () => {}),
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
      sendMessage: vi.fn(async (tabId, msg) => (msg.type === "switcherCommand" ? pageReply : undefined)),
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
    storage: { local: localArea, session: sessionArea },
    scripting: { executeScript: vi.fn(async () => []) },
    commands: { onCommand: on("commands.onCommand") },
    action: { openPopup: vi.fn(async () => {}) },
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
    Date: new Proxy(Date, { get: (_, prop) => globalThis.Date[prop], construct: (_, args) => new globalThis.Date(...args) }),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
  });
  vm.runInContext(source("background.js"), context);

  const send = (msg, sender = {}) =>
    new Promise((resolve) => {
      const async = listeners["runtime.onMessage"](msg, sender, resolve);
      if (!async) resolve(undefined);
    }).then((r) => JSON.parse(JSON.stringify(r ?? null)));

  return { chrome, listeners, local: localArea.data, session: sessionArea.data, send, canvases };
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
      const { send } = loadBackground({ local: { "thumb:https://recent.example/": "data:image/jpeg;base64,T3" } });
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

    it("falls back to the tab's last capture when its URL changed since", async () => {
      const { send } = loadBackground({
        local: { "thumb:https://old.example/inbox": "data:image/jpeg;base64,OLD" },
        session: { "lastCapture:1": "https://old.example/inbox" },
      });
      const tabs = await send({ type: "getTabs" }, { tab: { id: 2 } });
      expect(tabs.find((t) => t.id === 1).thumb).toBe("data:image/jpeg;base64,OLD");
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

  it("relays keys from an iframe to the top frame of the same tab", async () => {
    const { send, chrome } = loadBackground();
    const event = { type: "keydown", code: "Tab", altKey: true };
    await send({ type: "relayKey", event }, { tab: { id: 3 }, frameId: 7 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(3, { type: "relayedKey", event }, { frameId: 0 });
  });

  describe("Alt+W (open-switcher command)", () => {
    const press = async (bg, tab = { id: 3 }) => {
      bg.listeners["commands.onCommand"]("open-switcher", tab);
      await new Promise((r) => setTimeout(r, 0));
    };

    it("hands each press to the page, which opens or advances its overlay", async () => {
      const bg = loadBackground({ pageReply: { handled: true } });
      await press(bg);
      expect(bg.chrome.tabs.sendMessage).toHaveBeenCalledWith(3, { type: "switcherCommand" });
      expect(bg.chrome.action.openPopup).not.toHaveBeenCalled();
    });

    it("opens the toolbar popup where the page can't show the overlay", async () => {
      const bg = loadBackground({ pageReply: { handled: false } });
      await press(bg);
      expect(bg.chrome.action.openPopup).toHaveBeenCalledOnce();
    });

    it("opens the toolbar popup when the page has no content script (chrome:// pages)", async () => {
      const bg = loadBackground();
      bg.chrome.tabs.sendMessage.mockRejectedValueOnce(new Error("Receiving end does not exist."));
      await press(bg);
      expect(bg.chrome.action.openPopup).toHaveBeenCalledOnce();
    });

    it("advances the popup instead when it's already open", async () => {
      const bg = loadBackground({ popupOpen: true });
      await press(bg);
      expect(bg.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "popupCommand" });
      expect(bg.chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(bg.chrome.action.openPopup).not.toHaveBeenCalled();
    });

    it("ignores other commands", async () => {
      const bg = loadBackground();
      bg.listeners["commands.onCommand"]("something-else", { id: 3 });
      await new Promise((r) => setTimeout(r, 0));
      expect(bg.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
  });

  it("ignores unknown messages", async () => {
    const { listeners } = loadBackground();
    expect(listeners["runtime.onMessage"]({ type: "nope" }, {}, () => {})).toBe(false);
    expect(listeners["runtime.onMessage"](undefined, {}, () => {})).toBe(false);
  });

  it("forgets which capture belonged to a closed tab, but keeps the capture", async () => {
    const { listeners, local, session } = loadBackground({
      local: { "thumb:https://old.example/": "x" },
      session: { "lastCapture:1": "https://old.example/", "lastCapture:2": "https://current.example/" },
    });
    await listeners["tabs.onRemoved"](1);
    expect(session).toEqual({ "lastCapture:2": "https://current.example/" });
    expect(local).toEqual({ "thumb:https://old.example/": "x" });
  });

  it("removes the leftover debug log on install", async () => {
    const { listeners, local } = loadBackground({ local: { debugLog: [{}], "thumb:https://a.example/": "x" } });
    await listeners["runtime.onInstalled"]();
    expect(local).toEqual({ "thumb:https://a.example/": "x" });
  });

  it("injects the content scripts into already open web pages on install", async () => {
    const { listeners, chrome } = loadBackground();
    await listeners["runtime.onInstalled"]();
    const injected = chrome.scripting.executeScript.mock.calls.map(([arg]) => arg.target.tabId);
    expect(injected).toEqual([1, 2, 3]);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1, allFrames: true },
      files: ["switcher-ui.js", "content.js"],
    });
  });

  describe("thumbnails", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("captures and downscales the tab shortly after it is activated", async () => {
      const { listeners, chrome, local, session, canvases } = loadBackground();
      listeners["tabs.onActivated"]({ tabId: 2, windowId: 10 });
      expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(10, { format: "jpeg", quality: 80 });
      expect(canvases[0]).toMatchObject({ width: 640, height: 400 });
      expect(local["thumb:https://current.example/"]).toBe("data:image/jpeg;base64,AQID");
      expect(Object.keys(local.thumbIndex)).toEqual(["https://current.example/"]);
      expect(session["lastCapture:2"]).toBe("https://current.example/");
    });

    it("keeps captures across extension reloads (they live in storage.local)", async () => {
      const first = loadBackground();
      first.listeners["tabs.onActivated"]({ tabId: 2, windowId: 10 });
      await vi.runAllTimersAsync();

      // A reload wipes storage.session but not storage.local.
      const { send } = loadBackground({ local: first.local });
      const tabs = await send({ type: "getTabs" }, { tab: { id: 1 } });
      expect(tabs.find((t) => t.id === 2).thumb).toBe("data:image/jpeg;base64,AQID");
    });

    it("prunes the oldest captures past the limit", async () => {
      const index = {};
      const local = {};
      for (let i = 0; i < 400; i++) {
        index[`https://site${i}.example/`] = 1000 + i;
        local[`thumb:https://site${i}.example/`] = "x";
      }
      local.thumbIndex = index;
      const bg = loadBackground({ local });
      bg.listeners["tabs.onActivated"]({ tabId: 2, windowId: 10 });
      await vi.runAllTimersAsync();

      expect(Object.keys(bg.local.thumbIndex)).toHaveLength(400);
      expect(bg.local["thumb:https://site0.example/"]).toBeUndefined();
      expect(bg.local.thumbIndex["https://site0.example/"]).toBeUndefined();
      expect(bg.local["thumb:https://site1.example/"]).toBe("x");
      expect(bg.local["thumb:https://current.example/"]).toBeDefined();
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

    describe("snapshots requested by the page", () => {
      const current = { id: 2, windowId: 10, url: "https://current.example/", active: true };

      it("capture the visible tab right away and save it under its URL", async () => {
        const { send, chrome, local } = loadBackground();
        await send({ type: "snapshot" }, { tab: current });
        expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledOnce();
        await vi.runAllTimersAsync();
        expect(local["thumb:https://current.example/"]).toBe("data:image/jpeg;base64,AQID");
      });

      it("are ignored for background tabs", async () => {
        const { send, chrome } = loadBackground();
        await send({ type: "snapshot" }, { tab: { ...current, id: 1, active: false } });
        expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
      });

      it("respect Chrome's limit of two captures per second", async () => {
        const { send, chrome } = loadBackground();
        await send({ type: "snapshot" }, { tab: current });
        await send({ type: "snapshot" }, { tab: current });
        expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(600);
        await send({ type: "snapshot" }, { tab: current });
        expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
      });

      it("are discarded if the user switched tabs during the capture", async () => {
        const { send, chrome, local } = loadBackground();
        chrome.tabs.captureVisibleTab.mockImplementation(async () => {
          // Another tab of window 10 becomes active while capturing.
          chrome.tabs.query.mockImplementation(async () => [{ id: 1, windowId: 10, active: true }]);
          return "data:image/jpeg;base64,RAW";
        });
        await send({ type: "snapshot" }, { tab: current });
        await vi.runAllTimersAsync();
        expect(local).toEqual({});
      });
    });

    it("ignores focus leaving Chrome", async () => {
      const { listeners, chrome } = loadBackground();
      listeners["windows.onFocusChanged"](-1);
      await vi.runAllTimersAsync();
      expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    });

    it("silently skips pages that can't be captured", async () => {
      const { listeners, chrome, local } = loadBackground();
      chrome.tabs.captureVisibleTab.mockRejectedValue(new Error("Cannot access a chrome:// URL"));
      listeners["tabs.onActivated"]({ tabId: 2, windowId: 10 });
      await vi.runAllTimersAsync();
      expect(local).toEqual({});
    });
  });
});
