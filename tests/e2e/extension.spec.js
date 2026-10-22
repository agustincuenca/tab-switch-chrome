// End-to-end tests: load the unpacked extension into Chromium and drive real
// tabs. Pages are served by a local HTTP server: http://127.0.0.1:<port>/<name>
// gets the title "site-<name>". (Playwright's route.fulfill() can't be used:
// Chrome treats fulfilled navigations as error pages and skips content scripts.)

import { test as base, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import path from "node:path";

const extensionPath = path.resolve(import.meta.dirname, "../..");

const test = base.extend({
  site: async ({}, use) => {
    // /<name>/frame embeds a cross-origin iframe (localhost vs 127.0.0.1)
    // holding a text field, like an embedded editor.
    // /<name>/blocks-alt-tab swallows Alt+Tab keydowns like Google Calendar.
    const server = createServer((req, res) => {
      const [name, extra] = req.url.slice(1).split("/");
      const port = server.address().port;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (name === "inner") return res.end(`<input id="field">`);
      const frame = extra === "frame" ? `<iframe src="http://localhost:${port}/inner"></iframe>` : "";
      const blocker =
        extra === "blocks-alt-tab"
          ? `<script>addEventListener("keydown", (e) => e.code === "Tab" && e.altKey && e.stopImmediatePropagation(), true)</script>`
          : "";
      res.end(`<title>site-${name}</title>${blocker}<h1>site-${name}</h1>${frame}`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    await use((name) => `http://127.0.0.1:${server.address().port}/${name}`);
    server.close();
  },
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const [worker] = context.serviceWorkers();
    await use(worker ?? (await context.waitForEvent("serviceworker")));
  },
  // Opens each site as a tab in the same window (via chrome.tabs.create, so
  // they share a window like real user tabs) and returns the Playwright pages.
  openTabs: async ({ context, worker, site }, use) => {
    await use(async (names) => {
      const pages = [];
      for (const name of names) {
        const pagePromise = context.waitForEvent("page");
        await worker.evaluate((url) => chrome.tabs.create({ url }), site(name));
        const page = await pagePromise;
        await expect(page).toHaveTitle(`site-${name.split("/")[0]}`);
        pages.push(page);
      }
      return pages;
    });
  },
  activeTitle: async ({ worker }, use) => {
    await use(() =>
      worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, url: "http://127.0.0.1/*" });
        return tab?.title;
      })
    );
  },
});

// Same as the reload button in chrome://extensions (which needs developer
// mode). Resolves with the new service worker once onInstalled has had time
// to re-inject the content scripts into open tabs.
async function reloadExtension(context, worker) {
  const extensions = await context.newPage();
  await extensions.goto("chrome://extensions");
  await extensions.evaluate(async (id) => {
    await new Promise((r) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, r));
    await new Promise((r) => chrome.developerPrivate.reload(id, { failQuietly: true }, r));
  }, new URL(worker.url()).host);
  await extensions.close();
  let reloaded;
  await expect
    .poll(() => (reloaded = context.serviceWorkers().find((w) => w !== worker)), { timeout: 10_000 })
    .toBeTruthy();
  await new Promise((r) => setTimeout(r, 500));
  return reloaded;
}

const activeTitleIn = (worker) =>
  worker.evaluate(async () => (await chrome.tabs.query({ active: true, url: "http://127.0.0.1/*" }))[0]?.title);

async function holdAltAndTab(page, presses = 1) {
  await page.keyboard.down("Alt");
  for (let i = 0; i < presses; i++) await page.keyboard.press("Tab");
  await expect(page.locator("tab-switch-overlay")).toBeAttached();
}

test("Alt+Tab switches to the previously used tab", async ({ openTabs, activeTitle }) => {
  const [, , c] = await openTabs(["a", "b", "c"]);
  expect(await activeTitle()).toBe("site-c");

  await holdAltAndTab(c);
  await c.keyboard.up("Alt");

  await expect.poll(activeTitle).toBe("site-b");
});

test("Alt+Tab keeps working from the tab it switched to", async ({ openTabs, activeTitle }) => {
  const [, b, c] = await openTabs(["a", "b", "c"]);

  await holdAltAndTab(c);
  await c.keyboard.up("Alt");
  await expect.poll(activeTitle).toBe("site-b");

  await b.bringToFront();
  await holdAltAndTab(b);
  await b.keyboard.up("Alt");
  await expect.poll(activeTitle).toBe("site-c");
});

test("keeps working in tabs that were open before the extension was reloaded", async ({
  context,
  worker,
  openTabs,
}) => {
  const [, , c] = await openTabs(["a", "b", "c"]);

  const reloaded = await reloadExtension(context, worker);
  await c.bringToFront();

  await holdAltAndTab(c);
  await c.keyboard.up("Alt");
  await expect.poll(() => activeTitleIn(reloaded)).toBe("site-b");
});

test("works on pages that swallow the Alt+Tab keydown before the extension sees it", async ({
  context,
  worker,
  openTabs,
}) => {
  const [, , c] = await openTabs(["a", "b", "c/blocks-alt-tab"]);
  // Re-injecting into the open tab puts the page's listener ahead of ours.
  const reloaded = await reloadExtension(context, worker);
  await c.bringToFront();

  await holdAltAndTab(c, 2);
  await c.keyboard.up("Alt");
  await expect.poll(() => activeTitleIn(reloaded)).toBe("site-a");
});

test("works while keyboard focus is inside a cross-origin iframe", async ({ openTabs, activeTitle }) => {
  const [, , c] = await openTabs(["a", "b", "c/frame"]);
  const field = c.frameLocator("iframe").locator("#field");
  await field.click();
  await expect(field).toBeFocused();

  await holdAltAndTab(c);
  await c.keyboard.up("Alt");

  await expect.poll(activeTitle).toBe("site-b");
});

test("pressing Tab repeatedly while holding Alt goes further back", async ({ openTabs, activeTitle }) => {
  const [, , c] = await openTabs(["a", "b", "c"]);

  await holdAltAndTab(c, 2);
  await c.keyboard.up("Alt");

  await expect.poll(activeTitle).toBe("site-a");
});

test("Escape cancels the switch", async ({ openTabs, activeTitle }) => {
  const [, , c] = await openTabs(["a", "b", "c"]);

  await holdAltAndTab(c);
  await c.keyboard.press("Escape");
  await c.keyboard.up("Alt");

  await c.waitForTimeout(300);
  expect(await activeTitle()).toBe("site-c");
});

test("W closes the selected tab from the switcher", async ({ openTabs }) => {
  const [, b, c] = await openTabs(["a", "b", "c"]);

  await holdAltAndTab(c);
  await c.keyboard.press("KeyW");
  await c.keyboard.press("Escape");
  await c.keyboard.up("Alt");

  await expect.poll(() => b.isClosed()).toBe(true);
});

test("the content script does not break normal Tab navigation", async ({ openTabs }) => {
  const [page] = await openTabs(["a"]);
  await page.setContent('<input id="one"><input id="two">');
  await page.focus("#one");
  await page.keyboard.press("Tab");
  await expect(page.locator("#two")).toBeFocused();
});

test("the popup lists tabs and switches with Enter", async ({ context, worker, openTabs, activeTitle }) => {
  await openTabs(["a", "b"]);
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.bringToFront();
  await expect(popup.locator("#root")).toBeAttached();
  await popup.waitForTimeout(300);

  await popup.keyboard.press("Enter");

  // The popup tab itself is the current tab, so the selection starts on the
  // most recently used site.
  await expect.poll(activeTitle).toBe("site-b");
});

test("captures thumbnails of visited tabs and keeps them across extension reloads", async ({
  context,
  worker,
  openTabs,
}) => {
  const [a] = await openTabs(["a", "b"]);
  const tabA = await worker.evaluate(async () => (await chrome.tabs.query({ title: "site-a" }))[0]);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabA.id);
  await a.bringToFront();

  const storedThumb = (w) => w.evaluate((url) => chrome.storage.local.get(`thumb:${url}`), tabA.url);

  await expect
    .poll(() => storedThumb(worker), { timeout: 10_000 })
    .toEqual({ [`thumb:${tabA.url}`]: expect.stringMatching(/^data:image\/jpeg;base64,/) });

  const reloaded = await reloadExtension(context, worker);
  expect(await storedThumb(reloaded)).toEqual({ [`thumb:${tabA.url}`]: expect.stringMatching(/^data:image/) });
});

test("refreshes the thumbnail of the tab you leave with Alt+Tab", async ({ worker, openTabs, activeTitle }) => {
  const [, , c] = await openTabs(["a", "b", "c"]);
  const url = c.url();
  const storedThumb = async () => (await worker.evaluate((u) => chrome.storage.local.get(`thumb:${u}`), url))[`thumb:${url}`];

  // Thumbnail taken when the tab was activated.
  await expect.poll(storedThumb, { timeout: 10_000 }).toBeTruthy();
  const before = await storedThumb();

  // The page changes after that capture…
  await c.evaluate(() => {
    document.body.style.background = "#d93025";
    document.body.innerHTML = "<h1 style='font-size:120px;color:white'>CAMBIADA</h1>";
  });
  await c.waitForTimeout(700); // Chrome allows two captures per second

  // …and leaving it with Alt+Tab captures it again, without the switcher on it.
  await holdAltAndTab(c);
  await c.keyboard.up("Alt");
  await expect.poll(activeTitle).toBe("site-b");
  await expect.poll(storedThumb, { timeout: 5_000 }).not.toBe(before);

  // The middle of the new thumbnail is the page's red, not the switcher panel.
  const [r, g, b] = await c.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return [...context.getImageData(image.width / 2, image.height * 0.75, 1, 1).data];
  }, await storedThumb());
  expect(r).toBeGreaterThan(180);
  expect(g).toBeLessThan(100);
  expect(b).toBeLessThan(100);
});
