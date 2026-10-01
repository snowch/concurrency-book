// Drive the built book in a headless browser and check that the experiments are views of the
// kernel, in the three ways a browser can meet the page.
//
//     node tests/browser/smoke.mjs _build/html [--screenshots DIR]
//
// 1. Isolated by the server: the headers real threads need come with every response, and the
//    live run works at once. This is `make serve`.
// 2. Isolated by the service worker: the server sends no headers, as GitHub Pages does; the
//    page installs its worker, reloads once, and is then isolated. This is the published book.
// 3. Not isolated at all: service workers blocked, no headers. The page must stay useful, offer
//    the deterministic trace, and say why there is no live run.
//
// In every configuration the counts on the page are the kernel's: a plain run never exceeds its
// expectation, an atomic run meets it exactly, and the trace loses exactly what the schedule
// makes it lose.

import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(process.argv[2] || "_build/html");
const shotsAt = process.argv.indexOf("--screenshots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

function loadPlaywright() {
  const here = createRequire(import.meta.url);
  try {
    return here("playwright");
  } catch {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return createRequire(path.join(globalRoot, "noop.js"))("playwright");
  }
}
const { chromium } = loadPlaywright();

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

function serve(isolate) {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    try {
      if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error("no");
      const headers = { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" };
      if (isolate) {
        headers["cross-origin-opener-policy"] = "same-origin";
        headers["cross-origin-embedder-policy"] = "require-corp";
      }
      res.writeHead(200, headers);
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures += 1;
};
const num = (s) => Number(String(s).replace(/,/g, ""));

const browser = await chromium.launch({ headless: true });
if (shots) await mkdir(shots, { recursive: true });

async function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}

// The counter experiment on ch02, driven through a live run and a trace.
async function exerciseCounter(page, base, label) {
  await page.goto(base + "two-threads-one-variable.html");
  const lab = page.locator('.lab[data-experiment="counter"]').first();
  await page.waitForFunction(() => {
    const l = document.querySelector('.lab[data-experiment="counter"]');
    return l && l.dataset.state && l.dataset.state !== "loading";
  });
  check(await lab.getAttribute("data-live") === "true", `${label}: the page is isolated and offers a live run`);
  // The first live run starts by itself.
  await page.waitForFunction(() => document.querySelector('.lab[data-experiment="counter"]').dataset.state === "done", null, { timeout: 60000 });
  const expected = num(await lab.getAttribute("data-expected"));
  const observed = num(await lab.getAttribute("data-observed"));
  check(expected === 2 * 1000000, `${label}: two workers, a million increments each: expected ${expected}`);
  check(observed > 0 && observed <= expected, `${label}: the plain counter observed ${observed} (never more than expected; lost ${expected - observed} here)`);
  check(await lab.getAttribute("data-operation") === "plain", `${label}: the run was the plain increment`);
  // Change one thing: the atomic increment. The run restarts on the change.
  await lab.locator('select[name="operation"]').selectOption("atomic");
  await page.waitForFunction(() => {
    const l = document.querySelector('.lab[data-experiment="counter"]');
    return l.dataset.state === "done" && l.dataset.operation === "atomic";
  }, null, { timeout: 60000 });
  check(num(await lab.getAttribute("data-observed")) === expected, `${label}: the atomic counter observed exactly ${expected}`);
  check(num(await lab.getAttribute("data-lost")) === 0, `${label}: nothing lost atomically`);
  if (shots) await lab.screenshot({ path: path.join(shots, `${label.replace(/\W+/g, "-")}-live.png`) });
  // The trace: two threads, two increments each, alternating, loses two.
  await lab.locator('select[name="operation"]').selectOption("plain");
  await lab.locator('.lab-modes button[data-mode="trace"]').click();
  const stepper = lab.locator(".stepper");
  await stepper.locator("button", { hasText: "Run to the end" }).click();
  check(await stepper.getAttribute("data-trace-done") === "true" && await stepper.getAttribute("data-trace-lost") === "2",
    `${label}: the alternating trace of two threads, two increments each, loses exactly two`);
  await stepper.locator('select[name="schedule"]').selectOption("sequential");
  await stepper.locator("button", { hasText: "Run to the end" }).click();
  check(await stepper.getAttribute("data-trace-lost") === "0", `${label}: the sequential trace loses nothing`);
  await stepper.locator('select[name="schedule"]').selectOption("manual");
  await stepper.locator('button[data-thread="0"]').click();
  await stepper.locator('button[data-thread="1"]').click();
  check(await stepper.getAttribute("data-trace-steps") === "2", `${label}: stepping by hand runs one operation per click`);
  if (shots) await lab.screenshot({ path: path.join(shots, `${label.replace(/\W+/g, "-")}-trace.png`) });
}

// 1. Isolated by the server.
{
  const { server, base } = await serve(true);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = await watchErrors(page);
  await page.goto(base + "index.html");
  check((await page.title()) === "Concurrency at the Metal", "the cover is the book's title");
  check(await page.evaluate(() => crossOriginIsolated), "headers from the server isolate the page");
  await exerciseCounter(page, base, "server headers");
  // ch01 locks the workers to one: the control is text, and one worker loses nothing.
  await page.goto(base + "what-x-plus-plus-does.html");
  const one = page.locator('.lab[data-experiment="counter"]').first();
  await page.waitForFunction(() => document.querySelector('.lab[data-experiment="counter"]').dataset.state === "done", null, { timeout: 60000 });
  check(await one.locator(".controls .control.locked").count() === 1 && num(await one.getAttribute("data-workers")) === 1,
    "ch01 fixes the workers at one, shown as text");
  check(num(await one.getAttribute("data-lost")) === 0, "one worker alone loses nothing");
  // The architecture tabs: a choice on one page is the choice on every page.
  const tabs = page.locator('.tab-set[data-group="arch"]').first();
  await tabs.locator('button[data-key="aarch64"]').click();
  check(await page.evaluate(() => document.documentElement.dataset.arch) === "aarch64", "choosing AArch64 marks the page");
  check(await tabs.locator('.tab-panel[data-key="aarch64"]').isVisible() && !(await tabs.locator('.tab-panel[data-key="x86-64"]').isVisible()),
    "the AArch64 panel shows and the x86-64 panel hides");
  await page.goto(base + "atomic-operations.html");
  check(await page.evaluate(() => document.documentElement.dataset.arch) === "aarch64", "the choice follows the reader to the next chapter");
  check(await page.locator('.tab-set[data-group="arch"] .tab-panel[data-key="aarch64"]').first().isVisible(), "and that chapter's tab set shows AArch64");
  check(await page.locator(".tok-atomic").count() > 0, "atomic instructions are marked in the fragments");
  // The theme button cycles.
  await page.click("#theme");
  check(await page.evaluate(() => document.documentElement.dataset.theme) === "light", "the theme button turns the lights on");
  if (shots) await page.screenshot({ path: path.join(shots, "atomic-operations.png"), fullPage: true });
  check(errors.length === 0, `no page errors with server headers${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
  server.close();
}

// 2. Isolated by the service worker, as on GitHub Pages.
{
  const { server, base } = await serve(false);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = await watchErrors(page);
  await page.goto(base + "two-threads-one-variable.html");
  // The page registers the worker and reloads itself once; wait for the reloaded page.
  await page.waitForFunction(() => crossOriginIsolated, null, { timeout: 30000 });
  check(true, "without headers from the server, the service worker isolates the page after one reload");
  check(await page.evaluate(() => sessionStorage.getItem("concurrency-book:reloaded")) === "1", "the reload happens once per session");
  await exerciseCounter(page, base, "service worker");
  await page.goto(base + "preface.html");
  check(await page.evaluate(() => crossOriginIsolated), "every page served through the worker is isolated");
  check(errors.length === 0, `no page errors through the service worker${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
  server.close();
}

// 3. No isolation at all: the fallback.
{
  const { server, base } = await serve(false);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = await watchErrors(page);
  await page.goto(base + "two-threads-one-variable.html");
  const lab = page.locator('.lab[data-experiment="counter"]').first();
  await page.waitForFunction(() => {
    const l = document.querySelector('.lab[data-experiment="counter"]');
    return l && l.dataset.state === "ready";
  });
  check(!(await page.evaluate(() => crossOriginIsolated)), "with service workers blocked the page stays unisolated");
  check(await lab.getAttribute("data-live") === "false" && await lab.getAttribute("data-mode") === "trace",
    "the experiment opens in trace mode and offers no live run");
  check(await lab.locator('.lab-modes button[data-mode="live"]').isDisabled(), "the live button is disabled");
  check((await lab.locator(".lab-caps").innerText()).includes("not cross-origin isolated"), "the page says why");
  const stepper = lab.locator(".stepper");
  await stepper.locator("button", { hasText: "Run to the end" }).click();
  check(await stepper.getAttribute("data-trace-lost") === "2", "the trace still loses exactly two");
  await lab.locator('.lab-modes button[data-mode="native"]').click();
  check((await lab.locator(".lab-panel-native pre").innerText()).includes("make native KERNEL=counter"), "the desk commands are there");
  check(await page.locator("h2").count() >= 9, "the chapter's prose is all there without a live run");
  if (shots) await lab.screenshot({ path: path.join(shots, "fallback.png") });
  check(errors.length === 0, `no page errors without isolation${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
  server.close();
}

// A phone: the chapter list is closed, and the experiment fits the screen.
{
  const { server, base } = await serve(true);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(base + "two-threads-one-variable.html");
  check(!(await page.locator("#nav").isVisible()), "on a phone the chapter list is closed");
  await page.click("#menu");
  check(await page.locator("#nav").isVisible(), "the Chapters button opens it");
  await page.goBack();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  check(wide, "nothing pushes the page wider than the phone");
  await context.close();
  server.close();
}

await browser.close();
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("every browser check passed");
