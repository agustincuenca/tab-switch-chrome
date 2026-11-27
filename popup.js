// Toolbar popup: the switcher where the in-page overlay can't be drawn
// (chrome:// pages, the Web Store, the new tab page, the address bar focused),
// opened by Alt+W through background.js or by clicking the icon.
//
// It behaves like the overlay: keep Alt held, Alt+W (relayed by background.js
// as "popupCommand") or W step forward, Q back, releasing Alt switches. Enter
// and clicks still work for when it was opened without Alt.

const ui = new TabSwitcherUI(document.getElementById("root"), {
  mode: "popup",
  onActivate: activate,
  onClose: (tab) => chrome.runtime.sendMessage({ type: "close", tabId: tab.id }),
  onDismiss: () => window.close(),
});

let done = false;
let altReleasedEarly = false;

async function activate(tab) {
  if (done || !tab) return;
  done = true;
  await chrome.runtime.sendMessage({ type: "activate", tabId: tab.id });
  window.close();
}

chrome.runtime.sendMessage({ type: "getTabs" }).then((tabs) => {
  ui.show(tabs, tabs.length > 1 ? 1 : 0);
  // Alt let go before the tabs arrived: a quick Alt+W, so go straight to the
  // previous tab, the way a quick ⌥+Tab does.
  if (altReleasedEarly) activate(ui.selected);
});

document.addEventListener("keydown", (e) => {
  if (ui.visible && ui.handleKey(e)) e.preventDefault();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "popupCommand" && ui.visible) ui.move(1);
});

document.addEventListener("keyup", (e) => {
  if (e.key !== "Alt") return;
  e.preventDefault();
  if (ui.visible) activate(ui.selected);
  else altReleasedEarly = true;
});
