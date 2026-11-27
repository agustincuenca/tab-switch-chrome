import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPage, makeTabs, key, flush, cards, selectedTitle, source } from "./helpers.js";

describe("content script (Alt+Tab overlay)", () => {
  let window, messages;

  let deliver;

  function setup(tabCount = 4) {
    const page = createPage({ tabs: makeTabs(tabCount) });
    page.window.document.hasFocus = () => true;
    page.load("switcher-ui.js", "content.js");
    ({ window, messages, deliver } = page);
  }

  const overlay = () => window.document.querySelector("tab-switch-overlay")?.shadowRoot;
  const altTab = (init = {}) => key(window, "keydown", { key: "Tab", code: "Tab", altKey: true, ...init });
  const releaseAlt = () => key(window, "keyup", { key: "Alt", code: "AltLeft" });
  const sent = (type) => messages.filter((m) => m.type === type);

  beforeEach(() => setup());

  it("opens the switcher with the previous tab selected", async () => {
    const event = altTab();
    expect(event.defaultPrevented).toBe(true);
    await flush();
    expect(cards(overlay())).toHaveLength(4);
    expect(selectedTitle(overlay())).toBe("Tab 2");
  });

  it("switches to the selected tab when Alt is released", async () => {
    altTab();
    await flush();
    altTab();
    expect(selectedTitle(overlay())).toBe("Tab 3");
    releaseAlt();
    expect(sent("activate")).toEqual([{ type: "activate", tabId: 3 }]);
    expect(cards(overlay())).toHaveLength(0);
  });

  it("goes backwards with Shift", async () => {
    altTab({ shiftKey: true });
    await flush();
    expect(selectedTitle(overlay())).toBe("Tab 4");
  });

  it("wraps around when going backwards past the first tab", async () => {
    altTab();
    await flush();
    altTab({ shiftKey: true });
    altTab({ shiftKey: true });
    expect(selectedTitle(overlay())).toBe("Tab 4");
  });

  it("counts Tab presses made while the tab list is loading", async () => {
    altTab();
    altTab();
    await flush();
    expect(selectedTitle(overlay())).toBe("Tab 3");
  });

  it("a quick Alt+Tab tap switches to the previous tab without showing the overlay", async () => {
    altTab();
    releaseAlt();
    await flush();
    expect(sent("activate")).toEqual([{ type: "activate", tabId: 2 }]);
    expect(overlay() ? cards(overlay()) : []).toHaveLength(0);
  });

  it("Escape cancels without switching", async () => {
    altTab();
    await flush();
    key(window, "keydown", { key: "Escape", code: "Escape", altKey: true });
    releaseAlt();
    expect(sent("activate")).toHaveLength(0);
    expect(cards(overlay())).toHaveLength(0);
  });

  it("X closes the selected tab", async () => {
    altTab();
    await flush();
    key(window, "keydown", { key: "≈", code: "KeyX", altKey: true });
    expect(sent("close")).toEqual([{ type: "close", tabId: 2 }]);
    expect(cards(overlay())).toHaveLength(3);
  });

  it("swallows keys while open so the page never sees them", async () => {
    const seen = [];
    window.document.addEventListener("keydown", (e) => seen.push(e.code));
    altTab();
    await flush();
    const arrow = key(window, "keydown", { key: "ArrowRight", code: "ArrowRight", altKey: true });
    expect(arrow.defaultPrevented).toBe(true);
    expect(seen).toEqual([]);
  });

  it("leaves keys alone while closed", () => {
    const event = key(window, "keydown", { key: "a", code: "KeyA" });
    expect(event.defaultPrevented).toBe(false);
    expect(messages).toHaveLength(0);
  });

  it("ignores Tab without Alt, or with Ctrl/Cmd", () => {
    key(window, "keydown", { key: "Tab", code: "Tab" });
    altTab({ ctrlKey: true });
    altTab({ metaKey: true });
    expect(messages).toHaveLength(0);
  });

  it("does nothing when there is only one tab", async () => {
    setup(1);
    altTab();
    await flush();
    releaseAlt();
    expect(overlay()).toBeUndefined();
    expect(sent("activate")).toHaveLength(0);
  });

  it("closes the overlay when the window loses focus", async () => {
    altTab();
    await flush();
    window.dispatchEvent(new window.Event("blur"));
    releaseAlt();
    expect(cards(overlay())).toHaveLength(0);
    expect(sent("activate")).toHaveLength(0);
  });

  it("can be re-injected without registering the listeners twice", async () => {
    const page = createPage({ tabs: makeTabs(3) });
    page.load("switcher-ui.js", "content.js", "switcher-ui.js", "content.js");
    key(page.window, "keydown", { key: "Tab", code: "Tab", altKey: true });
    await flush();
    expect(page.messages.filter((m) => m.type === "getTabs")).toHaveLength(1);
  });

  it("recovers when a message to the extension fails", async () => {
    window.chrome.runtime.sendMessage = async () => {
      throw new Error("Could not establish connection.");
    };
    altTab();
    await flush();
    expect(overlay()).toBeUndefined();
    // Still usable afterwards: state went back to idle.
    expect(altTab().defaultPrevented).toBe(true);
  });

  it("an orphaned copy steps aside instead of swallowing keys", async () => {
    altTab();
    await flush();
    delete window.chrome.runtime.id; // extension context invalidated
    const event = altTab();
    expect(event.defaultPrevented).toBe(false);
    expect(window.document.querySelector("tab-switch-overlay")).toBeNull();
  });

  it("a re-injected copy replaces the previous one after an extension reload", async () => {
    altTab();
    await flush();
    releaseAlt();
    messages.length = 0;

    // Reload: the old copy keeps running but can no longer reach the extension.
    const staleRuntime = window.chrome.runtime;
    window.chrome = {
      runtime: {
        id: "test-extension",
        sendMessage: async (msg) => (messages.push(msg), msg.type === "getTabs" ? makeTabs(3) : undefined),
        onMessage: staleRuntime.onMessage,
      },
    };
    staleRuntime.sendMessage = async () => {
      throw new Error("Extension context invalidated.");
    };
    window.eval(source("switcher-ui.js") + source("content.js"));

    altTab();
    await flush();
    expect(sent("getTabs")).toHaveLength(1);
    expect(cards(overlay())).toHaveLength(3);
    expect(window.document.querySelectorAll("tab-switch-overlay")).toHaveLength(1);
    releaseAlt();
    expect(sent("activate")).toEqual([{ type: "activate", tabId: 2 }]);
  });

  describe("thumbnail snapshots", () => {
    // Makes "snapshot" requests hang until the returned function is called.
    function holdSnapshots() {
      const original = window.chrome.runtime.sendMessage;
      let release;
      const held = new Promise((resolve) => (release = resolve));
      window.chrome.runtime.sendMessage = (msg) => (msg.type === "snapshot" ? (messages.push(msg), held) : original(msg));
      return release;
    }

    it("asks for a snapshot of this tab as soon as Alt goes down", () => {
      key(window, "keydown", { key: "Alt", code: "AltLeft", altKey: true });
      key(window, "keydown", { key: "Alt", code: "AltLeft", altKey: true, repeat: true });
      expect(sent("snapshot")).toHaveLength(1);
    });

    it("waits for the snapshot before drawing the switcher", async () => {
      const release = holdSnapshots();
      key(window, "keydown", { key: "Alt", code: "AltLeft", altKey: true });
      altTab();
      await flush();
      expect(overlay()).toBeUndefined();
      release();
      await flush();
      expect(selectedTitle(overlay())).toBe("Tab 2");
      expect(sent("snapshot")).toHaveLength(1);
    });

    it("waits for the snapshot before a quick tap switches tabs", async () => {
      const release = holdSnapshots();
      key(window, "keydown", { key: "Alt", code: "AltLeft", altKey: true });
      altTab();
      releaseAlt();
      await flush();
      expect(sent("activate")).toHaveLength(0);
      release();
      await flush();
      expect(sent("activate")).toEqual([{ type: "activate", tabId: 2 }]);
    });

    it("does not wait forever for a slow snapshot", async () => {
      holdSnapshots();
      altTab();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(selectedTitle(overlay())).toBe("Tab 2");
    });

    it("takes one every 10 seconds while the tab is visible", async () => {
      vi.useFakeTimers();
      try {
        setup();
        await vi.advanceTimersByTimeAsync(25_000);
        expect(sent("snapshot")).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("keys relayed from a focused iframe", () => {
    let page;
    beforeEach(() => {
      page = createPage({ tabs: makeTabs(4) });
      page.load("switcher-ui.js", "content.js");
      ({ window, messages } = page);
    });
    const relayed = (type, init) => page.deliver({ type: "relayedKey", event: { type, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...init } });

    it("open the switcher and switch on Alt release", async () => {
      relayed("keydown", { key: "Tab", code: "Tab", altKey: true });
      await flush();
      expect(selectedTitle(overlay())).toBe("Tab 2");
      relayed("keydown", { key: "Tab", code: "Tab", altKey: true });
      relayed("keyup", { key: "Alt", code: "AltLeft" });
      expect(sent("activate")).toEqual([{ type: "activate", tabId: 3 }]);
    });

    it("ignore unrelated messages", () => {
      page.deliver({ type: "somethingElse" });
      page.deliver(undefined);
      expect(messages).toHaveLength(0);
    });
  });
});

describe("pages that swallow the Alt+Tab keydown before us", () => {
  // Google Calendar and Sheets stop Alt+Tab keydowns in their own listeners.
  // When the content script is injected into an already open tab, those run
  // first and only the keyup reaches us.
  let page, window;
  beforeEach(() => {
    page = createPage({ tabs: makeTabs(4) });
    window = page.window;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code === "Tab" && e.altKey) e.stopImmediatePropagation();
      },
      true
    );
    page.load("switcher-ui.js", "content.js");
  });
  const overlay = () => window.document.querySelector("tab-switch-overlay")?.shadowRoot;
  const pressTab = (init = {}) => {
    key(window, "keydown", { key: "Tab", code: "Tab", altKey: true, ...init });
    return key(window, "keyup", { key: "Tab", code: "Tab", altKey: true, ...init });
  };
  const sent = (type) => page.messages.filter((m) => m.type === type);

  it("opens the switcher from the keyup", async () => {
    key(window, "keydown", { key: "Alt", code: "AltLeft", altKey: true });
    const keyup = pressTab();
    expect(keyup.defaultPrevented).toBe(true);
    await flush();
    expect(selectedTitle(overlay())).toBe("Tab 2");
  });

  it("cycles on each keyup and switches when Alt is released", async () => {
    pressTab();
    await flush();
    pressTab();
    pressTab({ shiftKey: true });
    pressTab();
    expect(selectedTitle(overlay())).toBe("Tab 3");
    key(window, "keyup", { key: "Alt", code: "AltLeft" });
    expect(sent("activate")).toEqual([{ type: "activate", tabId: 3 }]);
  });

  it("does not count a press twice when both keydown and keyup arrive", async () => {
    // Shift+Alt+Tab isn't swallowed by this page, so we see both events.
    key(window, "keydown", { key: "Tab", code: "Tab", altKey: true, shiftKey: true });
    key(window, "keyup", { key: "Tab", code: "Tab", altKey: true, shiftKey: true });
    await flush();
    expect(selectedTitle(overlay())).toBe("Tab 4");
  });

  it("ignores keyups of plain Tab", async () => {
    key(window, "keyup", { key: "Tab", code: "Tab" });
    await flush();
    expect(page.messages).toHaveLength(0);
  });
});

describe("content script inside an iframe", () => {
  let page;
  beforeEach(() => {
    page = createPage({ iframe: true });
    page.load("switcher-ui.js", "content.js");
  });
  const relays = () => page.messages.filter((m) => m.type === "relayKey").map((m) => [m.event.type, m.event.code]);

  it("never renders an overlay itself", async () => {
    key(page.window, "keydown", { key: "Tab", code: "Tab", altKey: true });
    await flush();
    expect(page.window.document.querySelector("tab-switch-overlay")).toBeNull();
    expect(page.messages.filter((m) => m.type === "getTabs")).toHaveLength(0);
  });

  it("relays Alt+Tab and every key until Alt is released", () => {
    const first = key(page.window, "keydown", { key: "Tab", code: "Tab", altKey: true });
    const arrow = key(page.window, "keydown", { key: "ArrowRight", code: "ArrowRight", altKey: true });
    key(page.window, "keyup", { key: "Alt", code: "AltLeft" });
    const after = key(page.window, "keydown", { key: "a", code: "KeyA" });

    expect(first.defaultPrevented).toBe(true);
    expect(arrow.defaultPrevented).toBe(true);
    expect(after.defaultPrevented).toBe(false);
    expect(relays()).toEqual([
      ["keydown", "Tab"],
      ["keydown", "ArrowRight"],
      ["keyup", "AltLeft"],
    ]);
  });

  it("relays nothing for normal typing", () => {
    key(page.window, "keydown", { key: "Tab", code: "Tab" });
    key(page.window, "keydown", { key: "a", code: "KeyA", altKey: true });
    expect(relays()).toEqual([]);
  });

  it("relays the keyup when the page swallowed the Alt+Tab keydown", () => {
    page.window.addEventListener("keydown", (e) => e.stopImmediatePropagation(), true);
    page.load("switcher-ui.js", "content.js"); // re-inject after the page's listener
    key(page.window, "keydown", { key: "Tab", code: "Tab", altKey: true });
    key(page.window, "keyup", { key: "Tab", code: "Tab", altKey: true });
    key(page.window, "keyup", { key: "Alt", code: "AltLeft" });
    expect(relays()).toEqual([
      ["keyup", "Tab"],
      ["keyup", "AltLeft"],
    ]);
  });

  it("stops relaying when the iframe loses focus", () => {
    key(page.window, "keydown", { key: "Tab", code: "Tab", altKey: true });
    page.window.dispatchEvent(new page.window.Event("blur"));
    key(page.window, "keydown", { key: "a", code: "KeyA" });
    expect(relays()).toEqual([["keydown", "Tab"]]);
  });
});

describe("content script (Alt+W command)", () => {
  let page;
  const overlay = () => page.window.document.querySelector("tab-switch-overlay")?.shadowRoot;
  const sent = (type) => page.messages.filter((m) => m.type === type);
  const holdAlt = () => key(page.window, "keydown", { key: "Alt", code: "AltLeft", altKey: true });
  const releaseAlt = () => key(page.window, "keyup", { key: "Alt", code: "AltLeft" });
  // Alt+W reaches the page as a message from the service worker.
  const command = () => {
    let reply;
    page.deliverWithReply({ type: "switcherCommand" }, (r) => (reply = r));
    return reply;
  };

  beforeEach(() => {
    page = createPage({ tabs: makeTabs(4) });
    page.window.document.hasFocus = () => true;
    page.load("switcher-ui.js", "content.js");
  });

  it("opens the overlay with the previous tab selected, and each press moves forward", async () => {
    holdAlt();
    expect(command()).toEqual({ handled: true });
    await flush();
    expect(selectedTitle(overlay())).toBe("Tab 2");
    command();
    expect(selectedTitle(overlay())).toBe("Tab 3");
  });

  it("goes back with Q and switches when Alt is released", async () => {
    holdAlt();
    command();
    await flush();
    command();
    command();
    key(page.window, "keydown", { key: "œ", code: "KeyQ", altKey: true });
    expect(selectedTitle(overlay())).toBe("Tab 3");
    releaseAlt();
    expect(sent("activate")).toEqual([{ type: "activate", tabId: 3 }]);
  });

  it("counts presses that arrive while the tab list is loading", async () => {
    holdAlt();
    command();
    command();
    await flush();
    expect(selectedTitle(overlay())).toBe("Tab 3");
  });

  it("jumps straight to the previous tab on a quick Alt+W", async () => {
    holdAlt();
    releaseAlt(); // let go before the command reached the page
    command();
    await flush();
    expect(sent("activate")).toEqual([{ type: "activate", tabId: 2 }]);
    expect(overlay()?.querySelector(".card")).toBeFalsy();
  });

  it("declines when the page doesn't have the keyboard (address bar focused)", () => {
    page.window.document.hasFocus = () => false;
    expect(command()).toEqual({ handled: false });
    expect(sent("getTabs")).toHaveLength(0);
  });
});

describe("content script in an iframe (Alt+W command)", () => {
  let page;
  const relayed = () => page.messages.filter((m) => m.type === "relayKey").map((m) => m.event);

  beforeEach(() => {
    page = createPage({ tabs: makeTabs(3), iframe: true });
    page.window.document.hasFocus = () => true;
    page.load("switcher-ui.js", "content.js");
  });

  it("relays Q and Alt's release to the top frame after Alt+W", () => {
    key(page.window, "keydown", { key: "Alt", code: "AltLeft", altKey: true });
    page.deliver({ type: "switcherCommand" });
    key(page.window, "keydown", { key: "œ", code: "KeyQ", altKey: true });
    key(page.window, "keyup", { key: "Alt", code: "AltLeft" });
    expect(relayed().map((e) => `${e.type}:${e.code}`)).toEqual(["keydown:KeyQ", "keyup:AltLeft"]);
  });

  it("tells the top frame at once when Alt was already released (quick Alt+W)", () => {
    key(page.window, "keydown", { key: "Alt", code: "AltLeft", altKey: true });
    key(page.window, "keyup", { key: "Alt", code: "AltLeft" });
    page.deliver({ type: "switcherCommand" });
    expect(relayed()).toEqual([expect.objectContaining({ type: "keyup", key: "Alt" })]);
  });

  it("does nothing when the iframe doesn't have the keyboard", () => {
    page.window.document.hasFocus = () => false;
    page.deliver({ type: "switcherCommand" });
    key(page.window, "keydown", { key: "œ", code: "KeyQ", altKey: true });
    expect(relayed()).toEqual([]);
  });
});
