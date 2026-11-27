// Visual tab switcher, shared by the in-page overlay (content.js) and the
// toolbar popup (popup.js). Renders inside a shadow root so page styles
// can't leak in.
//
// Each card is drawn as a Chrome tab sitting on top of its page preview; the
// selected one takes the shape of the active tab, its flared corners merging
// into the preview. A caption below spells out the selected tab in full.

// Plain assignment (not ??=) so a re-injected copy replaces an outdated class
// left behind by a previous version of the extension.
globalThis.TabSwitcherUI = class TabSwitcherUI {
  static STYLES = `
    :host { all: initial; }
    .overlay, .popup {
      --panel: rgba(248, 249, 250, 0.86);
      --panel-solid: #f8f9fa;
      --surface: #ffffff;
      --active: #d3e3fd;
      --text: #1f1f1f;
      --muted: #5f6368;
      --hairline: rgba(0, 0, 0, 0.1);
      --key: #ffffff;
      --scrim: rgba(32, 33, 36, 0.12);
      --blank-l: 94%;
      --blank-s: 40%;
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font: 13px/1.35 var(--sans);
      color: var(--text);
    }
    @media (prefers-color-scheme: dark) {
      .overlay, .popup {
        --panel: rgba(32, 33, 36, 0.84);
        --panel-solid: #202124;
        --surface: #2d2e31;
        --active: #394a66;
        --text: #e8eaed;
        --muted: #9aa0a6;
        --hairline: rgba(255, 255, 255, 0.09);
        --key: #3c4043;
        --scrim: rgba(0, 0, 0, 0.28);
        --blank-l: 21%;
        --blank-s: 12%;
      }
    }

    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      background: var(--scrim);
    }
    .panel {
      box-sizing: border-box; max-width: min(94vw, 1360px);
      padding: 18px 18px 12px; border-radius: 18px;
      background: var(--panel);
      backdrop-filter: blur(30px) saturate(180%);
      -webkit-backdrop-filter: blur(30px) saturate(180%);
      border: 1px solid var(--hairline);
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
      animation: appear 110ms ease-out;
    }
    @keyframes appear { from { opacity: 0; transform: scale(0.985); } }

    .grid {
      display: flex; flex-wrap: wrap; justify-content: center; gap: 16px 12px;
      max-width: calc(var(--cols) * (var(--card-w) + 12px));
      max-height: calc(82vh - 110px); overflow-y: auto;
      padding: 2px 4px 8px; margin: 0 auto;
      scrollbar-width: thin; scrollbar-color: var(--hairline) transparent;
    }

    .card { width: var(--card-w); cursor: default; }
    .tab {
      position: relative; height: 30px; margin: 0 8px;
      display: flex; align-items: center; gap: 7px; padding: 0 10px;
      border-radius: 9px 9px 0 0; color: var(--muted);
    }
    .tab img { width: 16px; height: 16px; flex: none; }
    .title { flex: 1; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { flex: none; width: 13px; height: 13px; color: var(--muted); }
    .badge svg { display: block; width: 100%; height: 100%; }

    .page {
      position: relative; aspect-ratio: 16 / 10; border-radius: 9px; overflow: hidden;
      background: var(--surface); box-shadow: 0 0 0 1px var(--hairline);
      opacity: 0.7; transition: opacity 90ms ease-out;
    }
    .page img.shot { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
    .page.blank {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
      background: hsl(var(--hue) var(--blank-s) var(--blank-l));
    }
    .page img.big { width: 36px; height: 36px; filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.18)); }
    .page .site {
      max-width: 85%; font: 11px/1.3 var(--mono); color: var(--muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .card:hover .page { opacity: 0.85; }

    /* The active tab: header and frame share one color and flared corners. */
    .card.selected .tab { background: var(--active); color: var(--text); }
    .card.selected .tab::before, .card.selected .tab::after {
      content: ""; position: absolute; bottom: 0; width: 9px; height: 9px;
    }
    .card.selected .tab::before { left: -9px; background: radial-gradient(circle at 0 0, transparent 8.5px, var(--active) 9px); }
    .card.selected .tab::after { right: -9px; background: radial-gradient(circle at 100% 0, transparent 8.5px, var(--active) 9px); }
    .card.selected .page { opacity: 1; box-shadow: 0 0 0 3px var(--active), 0 10px 28px rgba(0, 0, 0, 0.28); }

    .footer {
      display: flex; align-items: center; gap: 24px;
      margin-top: 10px; padding: 10px 4px 0; border-top: 1px solid var(--hairline);
    }
    .caption { flex: 1; min-width: 0; }
    .caption-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .caption-meta { margin-top: 2px; font: 11px/1.4 var(--mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .caption-meta .window { color: var(--text); }
    .hints { flex: none; display: flex; gap: 14px; font-size: 11px; color: var(--muted); }
    .hints kbd {
      display: inline-block; min-width: 12px; margin-right: 5px; padding: 1px 5px; text-align: center;
      font: 11px/16px var(--mono); color: var(--text);
      background: var(--key); border-radius: 5px; box-shadow: inset 0 -1px 0 var(--hairline), 0 0 0 1px var(--hairline);
    }
    @media (max-width: 760px) { .overlay .hints { display: none; } }

    .popup .backdrop { position: static; background: none; }
    .popup .panel {
      max-width: none; border: 0; border-radius: 0; box-shadow: none;
      background: var(--panel-solid); animation: none;
    }
    .popup .grid { max-height: 440px; }

    @media (prefers-reduced-motion: reduce) {
      .panel { animation: none; }
      .page { transition: none; }
    }
  `;

  static HINTS = {
    overlay: [["\u2325", "suelta para ir"], ["\u21E5", "siguiente"], ["Q", "anterior"], ["X", "cerrar"], ["esc", "cancelar"]],
    popup: [["\u2325", "suelta para ir"], ["W", "siguiente"], ["Q", "anterior"], ["X", "cerrar"], ["esc", "salir"]],
  };

  static ICONS = {
    audible:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 5.2a4 4 0 0 1 0 5.6l-.9-.9a2.7 2.7 0 0 0 0-3.8zm1.8-1.8a6.5 6.5 0 0 1 0 9.2l-.9-.9a5.2 5.2 0 0 0 0-7.4z"/></svg>',
    pinned:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.6 1.5 14.5 5.4l-1.2.6-2.4 2.4.3 3.3-1.1 1.1-2.7-2.7L4 13.5H2.5V12l3.4-3.4-2.7-2.7 1.1-1.1 3.3.3 2.4-2.4z"/></svg>',
  };

  constructor(container, { mode = "overlay", onActivate, onClose, onDismiss } = {}) {
    this.mode = mode;
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
    this.currentWindow = tabs[0]?.windowId;
    this.wrapper.replaceChildren(this.render());
    this.layout();
    this.select(index);
  }

  hide() {
    this.wrapper.replaceChildren();
    this.tabs = [];
  }

  render() {
    const backdrop = el("div", "backdrop");
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) this.callbacks.onDismiss?.();
    });
    const panel = el("div", "panel");
    this.grid = el("div", "grid");
    this.tabs.forEach((tab) => this.grid.append(this.renderCard(tab)));

    const footer = el("div", "footer");
    const caption = el("div", "caption");
    this.captionTitle = el("div", "caption-title");
    this.captionMeta = el("div", "caption-meta");
    caption.append(this.captionTitle, this.captionMeta);
    const hints = el("div", "hints");
    for (const [key, label] of TabSwitcherUI.HINTS[this.mode]) {
      const hint = el("span", "hint");
      hint.append(el("kbd", "", key), label);
      hints.append(hint);
    }
    footer.append(caption, hints);

    panel.append(this.grid, footer);
    backdrop.append(panel);
    return backdrop;
  }

  renderCard(tab) {
    const card = el("div", "card");
    card.title = `${tab.title}\n${tab.url}`;

    const header = el("div", "tab");
    header.append(img(tab.favicon), el("span", "title", tab.title));
    for (const flag of ["audible", "pinned"]) {
      if (!tab[flag]) continue;
      const badge = el("span", `badge ${flag}`);
      badge.innerHTML = TabSwitcherUI.ICONS[flag];
      header.append(badge);
    }

    const page = el("div", "page");
    if (tab.thumb) {
      page.append(img(tab.thumb, "shot"));
    } else {
      // No screenshot yet: the favicon on a color derived from the site.
      page.classList.add("blank");
      page.style.setProperty("--hue", hueOf(hostOf(tab.url)));
      page.append(img(tab.favicon, "big"), el("span", "site", hostOf(tab.url)));
    }

    card.append(header, page);
    card.addEventListener("mouseenter", () => this.select(this.tabs.indexOf(tab)));
    card.addEventListener("mousedown", (e) => e.preventDefault());
    card.addEventListener("click", () => this.callbacks.onActivate?.(tab));
    return card;
  }

  // Picks the largest card width that fits every tab on screen without
  // scrolling (down to a minimum), and balances the rows.
  layout() {
    const gap = 12;
    const popup = this.mode === "popup";
    const width = (popup ? 760 : Math.min(innerWidth * 0.94, 1360)) - 44;
    const height = popup ? 440 : innerHeight * 0.82 - 110;
    const count = this.tabs.length;
    let cardWidth = 136;
    let columns = Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));
    for (let w = 248; w >= 136; w -= 8) {
      const cols = Math.max(1, Math.floor((width + gap) / (w + gap)));
      const rows = Math.ceil(count / cols);
      if (rows * (30 + (w * 10) / 16 + 16) <= height) {
        cardWidth = w;
        columns = cols;
        break;
      }
    }
    columns = Math.min(columns, Math.ceil(count / Math.ceil(count / columns)));
    this.wrapper.style.setProperty("--card-w", `${cardWidth}px`);
    this.wrapper.style.setProperty("--cols", columns);
  }

  select(index) {
    if (index < 0 || index >= this.tabs.length) return;
    this.index = index;
    [...this.grid.children].forEach((card, i) => card.classList.toggle("selected", i === this.index));
    this.grid.children[this.index]?.scrollIntoView({ block: "nearest" });
    this.updateCaption();
  }

  updateCaption() {
    const tab = this.selected;
    this.captionTitle.textContent = tab.title;
    this.captionMeta.textContent = hostOf(tab.url);
    if (tab.windowId !== this.currentWindow) {
      this.captionMeta.append(" · ", el("span", "window", "otra ventana"));
    }
  }

  move(delta) {
    const count = this.tabs.length;
    if (count) this.select((((this.index + delta) % count) + count) % count);
  }

  // Up/down arrows jump a full row: count the cards sharing the first row.
  moveRow(direction) {
    const cards = [...this.grid.children];
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
    this.grid.children[this.index].remove();
    this.select(Math.min(this.index, this.tabs.length - 1));
  }

  // Shared keyboard handling while the switcher is visible. Returns true if
  // the key was consumed.
  handleKey(e) {
    switch (e.code) {
      case "Tab":
        this.move(e.shiftKey ? -1 : 1);
        return true;
      // W/Q step forward/back like Tab/Shift+Tab: Alt+W opens the switcher
      // where Alt+Tab belongs to the OS (Windows, Linux) or doesn't reach the
      // page (chrome:// pages), and both keys sit under the left hand.
      case "KeyW":
        this.move(1);
        return true;
      case "KeyQ":
        this.move(-1);
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
      case "KeyX":
        this.removeSelected();
        return true;
    }
    return false;
  }
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
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

function hueOf(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}
