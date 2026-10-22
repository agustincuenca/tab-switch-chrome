// In-page overlay: hold Alt (Option on macOS) and press Tab to cycle through
// tabs, release Alt to switch. Shift+Tab goes backwards.
//
// When the extension is reloaded or updated, the copy of this script already
// running in open tabs is orphaned (it can no longer reach the extension) but
// its listeners stay alive, and background.js injects a fresh copy next to it.
// Each copy therefore tells any previous one to tear itself down, and an
// orphaned copy steps aside as soon as it notices.

(() => {
  if (window.top !== window) return;

  const TEARDOWN_EVENT = "tab-switch:teardown";
  window.dispatchEvent(new CustomEvent(TEARDOWN_EVENT));

  let ui = null;
  let state = "idle"; // idle | loading | open
  let pendingIndex = 1;
  let altReleased = false;

  function getUI() {
    if (ui && ui.host.isConnected) return ui;
    const host = document.createElement("tab-switch-overlay");
    document.documentElement.append(host);
    ui = new TabSwitcherUI(host, {
      onActivate: commit,
      onClose: (tab) => send({ type: "close", tabId: tab.id }),
      onDismiss: dismiss,
    });
    ui.host = host;
    return ui;
  }

  function send(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  // chrome.runtime.id disappears once the extension context is invalidated.
  function isOrphaned() {
    try {
      return !chrome.runtime?.id;
    } catch {
      return true;
    }
  }

  async function open(startIndex) {
    state = "loading";
    pendingIndex = startIndex;
    altReleased = false;
    let tabs;
    try {
      tabs = await send({ type: "getTabs" });
    } catch {
      state = "idle";
      return;
    }
    if (state !== "loading" || !Array.isArray(tabs) || tabs.length < 2) {
      state = "idle";
      return;
    }
    const index = ((pendingIndex % tabs.length) + tabs.length) % tabs.length;
    // Quick Alt+Tab tap: Alt was released before the list arrived.
    if (altReleased) {
      state = "idle";
      send({ type: "activate", tabId: tabs[index].id });
      return;
    }
    getUI().show(tabs, index);
    state = "open";
  }

  function commit(tab = ui?.selected) {
    dismiss();
    if (tab) send({ type: "activate", tabId: tab.id });
  }

  function dismiss() {
    state = "idle";
    ui?.hide();
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onKeyDown(e) {
    if (isOrphaned()) return teardown();
    if (e.code === "Tab" && e.altKey && !e.ctrlKey && !e.metaKey) {
      swallow(e);
      if (state === "idle") open(e.shiftKey ? -1 : 1);
      else if (state === "loading") pendingIndex += e.shiftKey ? -1 : 1;
      else ui.handleKey(e);
      return;
    }
    if (state === "open") {
      swallow(e);
      ui.handleKey(e);
    }
  }

  function onKeyUp(e) {
    if (isOrphaned()) return teardown();
    if (e.key !== "Alt") {
      if (state === "open") swallow(e);
      return;
    }
    if (state === "loading") {
      altReleased = true;
      swallow(e);
    } else if (state === "open") {
      swallow(e);
      commit();
    }
  }

  function onBlur() {
    if (state !== "idle") dismiss();
  }

  function onVisibilityChange() {
    if (document.hidden) dismiss();
  }

  function teardown() {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener(TEARDOWN_EVENT, teardown);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    state = "idle";
    ui?.host.remove();
    ui = null;
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  window.addEventListener(TEARDOWN_EVENT, teardown);
  document.addEventListener("visibilitychange", onVisibilityChange);
})();
