import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const root = new URL("../../", import.meta.url);

export const source = (file) => readFileSync(new URL(file, root), "utf8");

export function makeTabs(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    windowId: 1,
    title: `Tab ${i + 1}`,
    url: `https://site${i + 1}.example/page`,
    favicon: `chrome-extension://abc/_favicon/?pageUrl=site${i + 1}`,
    thumb: i % 2 === 0 ? `data:image/jpeg;base64,THUMB${i + 1}` : null,
    audible: false,
    pinned: false,
  }));
}

// A fresh jsdom page with a mocked `chrome.runtime` that records messages.
// Shadow roots are forced open so tests can inspect the rendered switcher.
export function createPage({ tabs = [] } = {}) {
  const { window } = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.com/",
  });
  const attachShadow = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function () {
    return attachShadow.call(this, { mode: "open" });
  };
  window.Element.prototype.scrollIntoView = () => {};

  const messages = [];
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        messages.push(msg);
        if (msg.type === "getTabs") return structuredClone(tabs);
      },
    },
  };

  return {
    window,
    messages,
    load: (...files) => files.forEach((file) => window.eval(source(file))),
  };
}

export function key(window, type, init) {
  const event = new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

export function cards(shadowRoot) {
  return [...shadowRoot.querySelectorAll(".card")];
}

export function selectedTitle(shadowRoot) {
  return shadowRoot.querySelector(".card.selected .title")?.textContent;
}
