// In-page overlay: hold Alt (Option on macOS) and press Tab to cycle through
// tabs, release Alt to switch. Shift+Tab goes backwards.

(() => {
  if (window.top !== window || window.__tabSwitchLoaded) return;
  window.__tabSwitchLoaded = true;

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

  async function open(startIndex) {
    state = "loading";
    pendingIndex = startIndex;
    altReleased = false;
    let tabs;
    try {
      tabs = await send({ type: "getTabs" });
    } catch {
      // Extension was reloaded: this orphaned script can no longer talk to it.
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

  window.addEventListener(
    "keydown",
    (e) => {
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
    },
    true
  );

  window.addEventListener(
    "keyup",
    (e) => {
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
    },
    true
  );

  window.addEventListener("blur", () => state !== "idle" && dismiss());
  document.addEventListener("visibilitychange", () => document.hidden && dismiss());
})();
