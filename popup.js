// Toolbar popup (Alt+Q by default). Same switcher, for pages where content
// scripts can't run: chrome:// pages, the Web Store, the new tab page…

const ui = new TabSwitcherUI(document.getElementById("root"), {
  mode: "popup",
  onActivate: async (tab) => {
    await chrome.runtime.sendMessage({ type: "activate", tabId: tab.id });
    window.close();
  },
  onClose: (tab) => chrome.runtime.sendMessage({ type: "close", tabId: tab.id }),
  onDismiss: () => window.close(),
});

chrome.runtime.sendMessage({ type: "getTabs" }).then((tabs) => {
  ui.show(tabs, tabs.length > 1 ? 1 : 0);
});

document.addEventListener("keydown", (e) => {
  if (ui.visible && ui.handleKey(e)) e.preventDefault();
});
