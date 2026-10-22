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
    const server = createServer((req, res) => {
      const name = `site-${req.url.slice(1)}`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<title>${name}</title><h1>${name}</h1>`);
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
        await expect(page).toHaveTitle(`site-${name}`);
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
  activeTitle,
}) => {
  const [, , c] = await openTabs(["a", "b", "c"]);

  // Same as the reload button in chrome://extensions (which needs developer mode).
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
  // Wait until onInstalled has re-injected the content script.
  await expect
    .poll(() => reloaded.evaluate(async () => (await chrome.tabs.query({ title: "site-c" })).length))
    .toBe(1);
  await c.waitForTimeout(500);
  await c.bringToFront();

  await holdAltAndTab(c);
  await c.keyboard.up("Alt");
  await expect
    .poll(() =>
      reloaded.evaluate(async () => (await chrome.tabs.query({ active: true, url: "http://127.0.0.1/*" }))[0]?.title)
    )
    .toBe("site-b");
});

test("pressing Tab repeatedly while holding Alt goes further back",async ({ openTabs, activeTitle }) => {
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

test("captures thumbnails of visited tabs", async ({ worker, openTabs }) => {
  const [a] = await openTabs(["a", "b"]);
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ title: "site-a" }))[0].id);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await a.bringToFront();

  await expect
    .poll(() => worker.evaluate((id) => chrome.storage.session.get(`thumb:${id}`), tabId), { timeout: 10_000 })
    .toEqual({ [`thumb:${tabId}`]: expect.stringMatching(/^data:image\/jpeg;base64,/) });
});
