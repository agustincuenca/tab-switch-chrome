import { describe, it, expect, beforeEach } from "vitest";
import { createPage, makeTabs, key, flush, cards, selectedTitle, source } from "./helpers.js";

describe("content script (Alt+Tab overlay)", () => {
  let window, messages;

  function setup(tabCount = 4) {
    const page = createPage({ tabs: makeTabs(tabCount) });
    page.load("switcher-ui.js", "content.js");
    ({ window, messages } = page);
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

  it("W closes the selected tab", async () => {
    altTab();
    await flush();
    key(window, "keydown", { key: "∑", code: "KeyW", altKey: true });
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
      runtime: { id: "test-extension", sendMessage: async (msg) => (messages.push(msg), msg.type === "getTabs" ? makeTabs(3) : undefined) },
    };
    staleRuntime.sendMessage = async () => {
      throw new Error("Extension context invalidated.");
    };
    window.eval(source("switcher-ui.js") + source("content.js"));

    altTab();
    await flush();
    expect(sent("getTabs")).toHaveLength(1);
    expect(cards(overlay())).toHaveLength(3);
    releaseAlt();
    expect(sent("activate")).toEqual([{ type: "activate", tabId: 2 }]);
  });
});
