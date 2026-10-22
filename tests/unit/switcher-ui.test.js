import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPage, makeTabs, cards, selectedTitle } from "./helpers.js";

describe("TabSwitcherUI", () => {
  let window, ui, shadow, callbacks;

  beforeEach(() => {
    const page = createPage();
    page.load("switcher-ui.js");
    window = page.window;
    const host = window.document.createElement("div");
    window.document.body.append(host);
    callbacks = { onActivate: vi.fn(), onClose: vi.fn(), onDismiss: vi.fn() };
    ui = new window.TabSwitcherUI(host, callbacks);
    shadow = host.shadowRoot;
  });

  const keydown = (code, init = {}) => ui.handleKey(new window.KeyboardEvent("keydown", { code, ...init }));

  it("renders one card per tab with title and host", () => {
    ui.show(makeTabs(3));
    const rendered = cards(shadow);
    expect(rendered).toHaveLength(3);
    expect(rendered[1].querySelector(".title").textContent).toBe("Tab 2");
    expect(rendered[1].querySelector(".host").textContent).toBe("site2.example");
    expect(ui.visible).toBe(true);
  });

  it("uses the thumbnail when available and the favicon otherwise", () => {
    ui.show(makeTabs(2));
    const [withThumb, withoutThumb] = cards(shadow);
    expect(withThumb.querySelector("img.shot").src).toContain("THUMB1");
    expect(withoutThumb.querySelector("img.shot")).toBeNull();
    expect(withoutThumb.querySelector("img.big").src).toContain("_favicon");
  });

  it("shows pinned and audible badges", () => {
    const tabs = makeTabs(1);
    tabs[0].pinned = true;
    tabs[0].audible = true;
    ui.show(tabs);
    expect(shadow.querySelectorAll(".badge")).toHaveLength(2);
  });

  it("renders titles as text, not HTML", () => {
    const tabs = makeTabs(1);
    tabs[0].title = '<img src=x onerror="alert(1)">';
    ui.show(tabs);
    expect(shadow.querySelector(".title").textContent).toBe(tabs[0].title);
    expect(shadow.querySelector(".title img")).toBeNull();
  });

  it("selects the initial index and wraps around in both directions", () => {
    ui.show(makeTabs(3), 1);
    expect(selectedTitle(shadow)).toBe("Tab 2");
    ui.move(1);
    ui.move(1);
    expect(selectedTitle(shadow)).toBe("Tab 1");
    ui.move(-1);
    expect(selectedTitle(shadow)).toBe("Tab 3");
    expect(shadow.querySelectorAll(".card.selected")).toHaveLength(1);
  });

  it("moves with Tab, Shift+Tab and arrow keys", () => {
    ui.show(makeTabs(4), 0);
    expect(keydown("Tab")).toBe(true);
    expect(selectedTitle(shadow)).toBe("Tab 2");
    keydown("ArrowRight");
    expect(selectedTitle(shadow)).toBe("Tab 3");
    keydown("ArrowLeft");
    keydown("Tab", { shiftKey: true });
    expect(selectedTitle(shadow)).toBe("Tab 1");
  });

  it("activates the selected tab on Enter and dismisses on Escape", () => {
    const tabs = makeTabs(3);
    ui.show(tabs, 2);
    keydown("Enter");
    expect(callbacks.onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
    keydown("Escape");
    expect(callbacks.onDismiss).toHaveBeenCalledOnce();
  });

  it("ignores unrelated keys", () => {
    ui.show(makeTabs(2));
    expect(keydown("KeyA")).toBe(false);
  });

  it("closes the selected tab with W and keeps a valid selection", () => {
    ui.show(makeTabs(3), 2);
    keydown("KeyW");
    expect(callbacks.onClose).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
    expect(cards(shadow)).toHaveLength(2);
    expect(selectedTitle(shadow)).toBe("Tab 2");
  });

  it("dismisses when the last tab is closed", () => {
    ui.show(makeTabs(1));
    keydown("KeyW");
    expect(callbacks.onDismiss).toHaveBeenCalledOnce();
  });

  it("selects on hover and activates on click", () => {
    ui.show(makeTabs(3), 0);
    const third = cards(shadow)[2];
    third.dispatchEvent(new window.MouseEvent("mouseenter"));
    expect(selectedTitle(shadow)).toBe("Tab 3");
    third.click();
    expect(callbacks.onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it("dismisses when clicking the backdrop", () => {
    ui.show(makeTabs(2));
    shadow.querySelector(".backdrop").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    expect(callbacks.onDismiss).toHaveBeenCalledOnce();
  });

  it("hide() empties the switcher", () => {
    ui.show(makeTabs(2));
    ui.hide();
    expect(ui.visible).toBe(false);
    expect(cards(shadow)).toHaveLength(0);
    expect(ui.selected).toBeUndefined();
  });

  it("can be loaded twice without redeclaring the class", () => {
    const page = createPage();
    expect(() => page.load("switcher-ui.js", "switcher-ui.js")).not.toThrow();
  });
});
