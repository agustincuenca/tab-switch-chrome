// In-page overlay: hold Alt (Option on macOS) and press Tab to cycle through
// tabs, release Alt to switch. Shift+Tab goes backwards.
//
// Alt+W does the same where Alt+Tab belongs to the OS (Windows, Linux). It's
// an extension command, so the page never sees it: the service worker sends
// it here as a "switcherCommand" message, once per press (see background.js).
//
// The overlay lives in the top frame. When keyboard focus is inside an iframe
// (editors, embedded apps…) the keys never reach the top frame, so the copy
// running in the iframe relays them through the service worker.
//
// When the extension is reloaded or updated, the copy of this script already
// running in open tabs is orphaned (it can no longer reach the extension) but
// its listeners stay alive, and background.js injects a fresh copy next to it.
// Each copy therefore tells any previous one to tear itself down, and an
// orphaned copy steps aside as soon as it notices.

(() => {
  const TEARDOWN_EVENT = "tab-switch:teardown";
  const isTopFrame = window.top === window;
  window.dispatchEvent(new CustomEvent(TEARDOWN_EVENT));

  // chrome.runtime.id disappears once the extension context is invalidated.
  function isOrphaned() {
    try {
      return !chrome.runtime?.id;
    } catch {
      return true;
    }
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  const isAltTab = (e) => e.code === "Tab" && e.altKey && !e.ctrlKey && !e.metaKey;

  const listeners = [];
  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  }

  function teardown() {
    listeners.splice(0).forEach((remove) => remove());
    state = "idle";
    ui?.host.remove();
    ui = null;
  }
  listen(window, TEARDOWN_EVENT, teardown);

  let ui = null;
  let state = "idle"; // idle | loading | open

  if (!isTopFrame) {
    // From Alt+Tab until Alt is released, forward every key to the top frame.
    // The top frame turns a keyup without its keydown into the press (see
    // `pressed` below), so a keydown swallowed by the page is covered by
    // relaying the keyup.
    let relaying = false;
    let altState = "unknown"; // down | up | unknown
    const pressed = new Set();
    const relay = (e) => {
      const { type, key, code, altKey, shiftKey, ctrlKey, metaKey } = e;
      chrome.runtime
        .sendMessage({ type: "relayKey", event: { type, key, code, altKey, shiftKey, ctrlKey, metaKey } })
        .catch(() => {});
    };
    listen(
      window,
      "keydown",
      (e) => {
        if (isOrphaned()) return teardown();
        pressed.add(e.code);
        if (e.key === "Alt") altState = "down";
        if (isAltTab(e)) relaying = true;
        if (!relaying) return;
        swallow(e);
        relay(e);
      },
      true
    );
    listen(
      window,
      "keyup",
      (e) => {
        if (isOrphaned()) return;
        const missedKeyDown = !pressed.delete(e.code);
        if (e.key === "Alt") altState = "up";
        if (missedKeyDown && isAltTab(e)) relaying = true;
        if (!relaying) return;
        swallow(e);
        if (e.key === "Alt") relaying = false;
        relay(e);
      },
      true
    );
    listen(window, "blur", () => {
      relaying = false;
      altState = "unknown";
      pressed.clear();
    });
    // Alt+W opened the overlay in the top frame while this iframe has the
    // keyboard: relay what follows (Q, Alt's release) like after Alt+Tab. If
    // Alt was already let go (a quick Alt+W), say so right away.
    const onFrameMessage = (msg) => {
      if (msg?.type !== "switcherCommand" || !document.hasFocus()) return;
      relaying = true;
      if (altState === "up") {
        relaying = false;
        relay({ type: "keyup", key: "Alt", code: "AltLeft", altKey: false, shiftKey: false, ctrlKey: false, metaKey: false });
      }
    };
    chrome.runtime.onMessage.addListener(onFrameMessage);
    listeners.push(() => {
      try {
        chrome.runtime.onMessage.removeListener(onFrameMessage);
      } catch {}
    });
    return;
  }

  let pendingIndex = 1;
  let altReleased = false;
  // Whether Alt is held, as far as this frame has seen. "unknown" after focus
  // moved away (into an iframe, another window…).
  let altState = "unknown";

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

  // Keeps this tab's thumbnail current: the service worker screenshots it
  // when Alt goes down (we may be about to leave) and every few seconds while
  // it's visible. The switcher waits for a pending screenshot before drawing
  // itself or switching away, so it never ends up in the picture.
  const SNAPSHOT_EVERY_MS = 10_000;
  const SNAPSHOT_WAIT_MS = 250;
  let snapshotting = null;

  function requestSnapshot() {
    snapshotting ??= send({ type: "snapshot" })
      .catch(() => {})
      .finally(() => (snapshotting = null));
    return snapshotting;
  }

  function snapshotSettled() {
    return Promise.race([requestSnapshot(), new Promise((resolve) => setTimeout(resolve, SNAPSHOT_WAIT_MS))]);
  }

  async function open(startIndex) {
    state = "loading";
    pendingIndex = startIndex;
    altReleased = false;
    let tabs;
    try {
      [tabs] = await Promise.all([send({ type: "getTabs" }), snapshotSettled()]);
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

  // Codes whose keydown we received. Pages that registered their listeners
  // before ours (always the case when we're injected into an open tab) can
  // swallow a keydown — Google Calendar and Sheets do it with Alt+Tab — but
  // the keyup still reaches us, so a keyup without its keydown is handled as
  // the press.
  const pressed = new Set();

  function onKeyDown(e) {
    if (isOrphaned()) return teardown();
    pressed.add(e.code);
    if (e.key === "Alt") altState = "down";
    if (e.key === "Alt" && !e.repeat && state === "idle") requestSnapshot();
    handlePress(e);
  }

  function handlePress(e) {
    if (isAltTab(e)) {
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
    const missedKeyDown = !pressed.delete(e.code);
    if (e.key === "Alt") altState = "up";
    if (e.key !== "Alt") {
      if (missedKeyDown && (isAltTab(e) || state === "open")) handlePress(e);
      else if (state === "open") swallow(e);
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
    altState = "unknown";
    pressed.clear();
    if (state !== "idle") dismiss();
  }

  function onVisibilityChange() {
    if (!document.hidden) return;
    pressed.clear();
    dismiss();
  }

  // Alt+W, relayed by the service worker. Opens the overlay with the previous
  // tab selected, or moves forward if it's already up. Answers whether it
  // took it: with the address bar focused the page can't see Alt's release,
  // so the service worker opens the toolbar popup instead.
  function onCommand() {
    if (isOrphaned() || !document.hasFocus()) return false;
    if (state === "open") {
      ui.move(1);
    } else if (state === "loading") {
      pendingIndex += 1;
    } else {
      open(1);
      // Alt was let go before the command reached us: a quick Alt+W.
      if (altState === "up") altReleased = true;
    }
    return true;
  }

  // Keys relayed from an iframe that has keyboard focus, and Alt+W.
  function onMessage(msg, sender, sendResponse) {
    if (msg?.type === "switcherCommand") {
      sendResponse({ handled: onCommand() });
      return;
    }
    if (msg?.type !== "relayedKey") return;
    const e = { ...msg.event, preventDefault() {}, stopImmediatePropagation() {} };
    if (e.type === "keydown") onKeyDown(e);
    else onKeyUp(e);
  }

  listen(window, "keydown", onKeyDown, true);
  listen(window, "keyup", onKeyUp, true);
  listen(window, "blur", onBlur);
  listen(document, "visibilitychange", onVisibilityChange);
  chrome.runtime.onMessage.addListener(onMessage);
  const snapshotTimer = setInterval(() => {
    if (isOrphaned()) return teardown();
    if (state === "idle" && !document.hidden) requestSnapshot();
  }, SNAPSHOT_EVERY_MS);
  listeners.push(() => clearInterval(snapshotTimer));
  listeners.push(() => {
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {}
  });
})();
