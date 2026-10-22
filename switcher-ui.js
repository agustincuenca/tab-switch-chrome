// Visual tab switcher, shared by the in-page overlay (content.js) and the
// toolbar popup (popup.js). Renders inside a shadow root so page styles
// can't leak in.

// Plain assignment (not ??=) so a re-injected copy replaces an outdated class
// left behind by a previous version of the extension.
globalThis.TabSwitcherUI = class TabSwitcherUI {
  static STYLES = `
    :host { all: initial; }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .popup .backdrop { position: static; }
    .panel {
      max-width: min(92vw, 1240px); max-height: 82vh; overflow-y: auto;
      padding: 14px; border-radius: 16px;
      background: rgba(32, 33, 36, 0.82);
      backdrop-filter: blur(24px) saturate(160%);
      -webkit-backdrop-filter: blur(24px) saturate(160%);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
      display: flex; flex-wrap: wrap; justify-content: center; gap: 10px;
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent;
    }
    .popup .panel { max-width: none; max-height: 560px; border-radius: 0; box-shadow: none; background: #202124; }
    .card {
      width: 220px; padding: 8px; border-radius: 10px; box-sizing: border-box;
      color: #e8eaed; cursor: pointer; border: 2px solid transparent;
    }
    .popup .card { width: 172px; }
    .card.selected { background: rgba(138, 180, 248, 0.22); border-color: #8ab4f8; }
    .thumb {
      aspect-ratio: 16 / 10; border-radius: 6px; overflow: hidden;
      background: rgba(255, 255, 255, 0.06);
      display: flex; align-items: center; justify-content: center;
    }
    .thumb img.shot { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
    .thumb img.big { width: 48px; height: 48px; opacity: 0.85; }
    .label { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
    .label img { width: 16px; height: 16px; flex: none; }
    .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { flex: none; font-size: 11px; opacity: 0.7; }
    .host { margin-top: 2px; font-size: 11px; color: #9aa0a6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;

  constructor(container, { mode = "overlay", onActivate, onClose, onDismiss } = {}) {
    this.callbacks = { onActivate, onClose, onDismiss };
    this.tabs = [];
    this.index = 0;
    this.root = container.attachShadow({ mode: "closed" });
    this.root.innerHTML = `<style>${TabSwitcherUI.STYLES}</style><div class="${mode}"></div>`;
    this.wrapper = this.root.lastElementChild;
  }

  get visible() {
    return this.wrapper.childElementCount > 0;
  }

  get selected() {
    return this.tabs[this.index];
  }

  show(tabs, index = 0) {
    this.tabs = tabs;
    this.wrapper.replaceChildren(this.render());
    this.select(index);
  }

  hide() {
    this.wrapper.replaceChildren();
    this.tabs = [];
  }

  render() {
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) this.callbacks.onDismiss?.();
    });
    this.panel = document.createElement("div");
    this.panel.className = "panel";
    this.tabs.forEach((tab, i) => this.panel.append(this.renderCard(tab, i)));
    backdrop.append(this.panel);
    return backdrop;
  }

  renderCard(tab, i) {
    const card = document.createElement("div");
    card.className = "card";
    const thumb = el("div", "thumb");
    thumb.append(tab.thumb ? img(tab.thumb, "shot") : img(tab.favicon, "big"));
    const label = el("div", "label");
    label.append(img(tab.favicon), el("span", "title", tab.title));
    if (tab.audible) label.append(el("span", "badge", "\u{1F50A}"));
    if (tab.pinned) label.append(el("span", "badge", "\u{1F4CC}"));
    card.append(thumb, label, el("div", "host", hostOf(tab.url)));
    card.title = `${tab.title}\n${tab.url}`;
    card.addEventListener("mouseenter", () => this.select(this.tabs.indexOf(tab)));
    card.addEventListener("mousedown", (e) => e.preventDefault());
    card.addEventListener("click", () => this.callbacks.onActivate?.(tab));
    return card;

    function el(tag, className, text) {
      const node = document.createElement(tag);
      node.className = className;
      if (text) node.textContent = text;
      return node;
    }
    function img(src, className = "") {
      const node = document.createElement("img");
      node.src = src;
      node.className = className;
      node.alt = "";
      return node;
    }
    function hostOf(url) {
      try {
        return new URL(url).host || url;
      } catch {
        return url;
      }
    }
  }

  select(index) {
    if (index < 0 || index >= this.tabs.length) return;
    this.index = index;
    [...this.panel.children].forEach((card, i) => card.classList.toggle("selected", i === this.index));
    this.panel.children[this.index]?.scrollIntoView({ block: "nearest" });
  }

  move(delta) {
    const count = this.tabs.length;
    if (count) this.select((((this.index + delta) % count) + count) % count);
  }

  // Up/down arrows jump a full row: count the cards sharing the first row.
  moveRow(direction) {
    const cards = [...this.panel.children];
    const firstTop = cards[0]?.offsetTop;
    const columns = cards.filter((c) => c.offsetTop === firstTop).length || 1;
    const target = this.index + direction * columns;
    if (target >= 0 && target < cards.length) this.select(target);
  }

  removeSelected() {
    const tab = this.selected;
    if (!tab) return;
    this.callbacks.onClose?.(tab);
    this.tabs.splice(this.index, 1);
    if (!this.tabs.length) return this.callbacks.onDismiss?.();
    this.panel.children[this.index].remove();
    this.select(Math.min(this.index, this.tabs.length - 1));
  }

  // Shared keyboard handling while the switcher is visible. Returns true if
  // the key was consumed.
  handleKey(e) {
    switch (e.code) {
      case "Tab":
        this.move(e.shiftKey ? -1 : 1);
        return true;
      case "ArrowRight":
        this.move(1);
        return true;
      case "ArrowLeft":
        this.move(-1);
        return true;
      case "ArrowDown":
        this.moveRow(1);
        return true;
      case "ArrowUp":
        this.moveRow(-1);
        return true;
      case "Enter":
      case "Space":
        this.callbacks.onActivate?.(this.selected);
        return true;
      case "Escape":
        this.callbacks.onDismiss?.();
        return true;
      case "KeyW":
        this.removeSelected();
        return true;
    }
    return false;
  }
};
