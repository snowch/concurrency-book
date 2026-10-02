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
  // The teaching machine is the same model drawn as a machine: a card per thread, the registers
  // each has loaded, the shared memory, and the program with each thread's place marked.
  check(await stepper.locator(".machine .cpu").count() === 2 && await stepper.getAttribute("data-machine-registers") === "2",
    `${label}: the teaching machine shows two threads, each holding the counter it loaded`);
  check((await stepper.locator(".machine .memory").innerText()).includes("counter") && await stepper.locator(".machine ol.listing li.at").count() >= 1,
    `${label}: the machine shows the memory and marks each thread's place in the program`);
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
  // Its second panel opens on the trace, where the teaching machine lists its program beside
  // the line of C each group of operations mirrors.
  const two = page.locator('.lab[data-experiment="counter"]').nth(1);
  check(await two.getAttribute("data-mode") === "trace" && (await two.locator(".machine ol.listing .src").first().innerText()).includes("counter++"),
    "ch01's second panel opens on the trace, with the C beside the machine's program");
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

// Part I and II's other experiments, driven live with server headers.
{
  const { server, base } = await serve(true);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = await watchErrors(page);
  const settled = async (nth = 0, extra = "") => {
    await page.waitForFunction(({ nth, extra }) => {
      const l = document.querySelectorAll(".lab[data-experiment]")[nth];
      return l && l.dataset.state === "done" && (!extra || l.dataset[extra.split("=")[0]] === extra.split("=")[1]);
    }, { nth, extra }, { timeout: 90000 });
    return page.locator(".lab[data-experiment]").nth(nth);
  };
  // ch04: compare-and-swap is exact and counts retries; the lock built from it is exact.
  await page.goto(base + "compare-and-swap.html");
  let lab = await settled(0);
  check(num(await lab.getAttribute("data-observed")) === num(await lab.getAttribute("data-expected")),
    `ch04 cas: observed ${await lab.getAttribute("data-observed")} of ${await lab.getAttribute("data-expected")} (exact; ${await lab.getAttribute("data-retries")} retries)`);
  check(num(await lab.getAttribute("data-most")) <= num(await lab.getAttribute("data-retries")), "ch04 cas: one worker's retries never exceed the total");
  lab = await settled(1);
  check(await lab.getAttribute("data-operation") === "lock" && num(await lab.getAttribute("data-observed")) === num(await lab.getAttribute("data-expected")),
    "ch04 lock: the counter under the compare-and-swap lock is exact");
  // ch05: test-and-set is exact and spins; test-then-set is not a lock.
  await page.goto(base + "test-and-set-and-spinlocks.html");
  lab = await settled(0);
  check(num(await lab.getAttribute("data-observed")) === num(await lab.getAttribute("data-expected")), `ch05 tas: exact, ${await lab.getAttribute("data-spins")} spins`);
  check(await lab.locator(".worker-bars .bar-row").count() === 4, "ch05: a spin bar per worker");
  lab = await settled(1);
  check(await lab.getAttribute("data-operation") === "broken" && num(await lab.getAttribute("data-observed")) <= num(await lab.getAttribute("data-expected")),
    `ch05 broken: ${await lab.getAttribute("data-observed")} of ${await lab.getAttribute("data-expected")} (never more; lost ${num(await lab.getAttribute("data-expected")) - num(await lab.getAttribute("data-observed"))} here)`);
  // ch06: the spinlock spins and never sleeps; the sleeping lock sleeps and never spins.
  await page.goto(base + "from-spinlock-to-mutex.html");
  lab = await settled(0);
  check(num(await lab.getAttribute("data-sleeps")) === 0 && num(await lab.getAttribute("data-observed")) === num(await lab.getAttribute("data-expected")), `ch06 spin: exact, ${await lab.getAttribute("data-spins")} spins, no sleeps`);
  await lab.locator('select[name="operation"]').selectOption("sleep");
  lab = await settled(0, "operation=sleep");
  check(num(await lab.getAttribute("data-spins")) === 0 && num(await lab.getAttribute("data-observed")) === num(await lab.getAttribute("data-expected")), `ch06 sleep: exact, ${await lab.getAttribute("data-sleeps")} sleeps, no spins`);
  // ch07: the plain loop never ends and the run is stopped; the volatile loop ends on the flag.
  await page.goto(base + "the-compiler-is-part-of-the-story.html");
  lab = page.locator('.lab[data-experiment="compiler"]').first();
  await page.waitForFunction(() => document.querySelector('.lab[data-experiment="compiler"]').dataset.state === "ready");
  check(!(await lab.getAttribute("data-outcome")), "ch07: the panel does not run by itself");
  await lab.locator("button.run-live").click();
  await page.waitForFunction(() => document.querySelector('.lab[data-experiment="compiler"]').dataset.outcome === "timeout", null, { timeout: 30000 });
  check(true, "ch07 plain: the run did not finish and the workers were stopped");
  check((await lab.locator(".lab-timeout").innerText()).includes("never reads the flag again"), "ch07 plain: the panel says why");
  await lab.locator('select[name="flag"]').selectOption("volatile");
  await lab.locator("button.run-live").click();
  await page.waitForFunction(() => document.querySelector('.lab[data-experiment="compiler"]').dataset.outcome === "returned", null, { timeout: 30000 });
  check(num(await lab.getAttribute("data-seen")) === 1, "ch07 volatile: the loop ended on the flag");
  check(errors.length === 0, `no page errors on ch04 to ch07${errors.length ? ": " + errors.join(" | ") : ""}`);
  // ch08: a volatile handover counts stale reads; release and acquire never do.
  await page.goto(base + "acquire-and-release.html");
  lab = await settled(0);
  check(num(await lab.getAttribute("data-trials")) === 100000 && num(await lab.getAttribute("data-stale")) >= 0,
    `ch08 volatile: ${await lab.getAttribute("data-stale")} stale reads of 100000 (whatever this device allows)`);
  lab = await settled(1);
  check(await lab.getAttribute("data-ordering") === "release-acquire" && num(await lab.getAttribute("data-stale")) === 0, "ch08 release-acquire: no stale read");
  await lab.locator('.lab-modes button[data-mode="trace"]').click();
  await lab.locator(".stepper button", { hasText: "Run to the end" }).click();
  check((await lab.locator(".stepper").getAttribute("data-trace-outcome")).includes("published"), "ch08 trace: with a release the reader sees the data");
  // ch10: volatile accesses may load both zero; sequentially consistent ones never do.
  await page.goto(base + "sequential-consistency.html");
  lab = await settled(0);
  check(num(await lab.getAttribute("data-trials")) === 100000, `ch10 volatile: ${await lab.getAttribute("data-both_zero")} of 100000 trials loaded both zero (whatever this device allows)`);
  await lab.locator('select[name="ordering"]').selectOption("seq_cst");
  lab = await settled(0, "ordering=seq_cst");
  check(num(await lab.getAttribute("data-both_zero")) === 0, "ch10 seq_cst: never both zero");
  await lab.locator('.lab-modes button[data-mode="trace"]').click();
  await lab.locator('.stepper select[name="schedule"]').selectOption("alternate");
  await lab.locator(".stepper button", { hasText: "Run to the end" }).click();
  check((await lab.locator(".stepper").getAttribute("data-trace-outcome")).includes("interleaving explains"), "ch10 trace: under seq_cst an interleaving explains the outcome");
  // ch11: the fence forbids both zero.
  await page.goto(base + "fences.html");
  lab = await settled(0);
  check(await lab.getAttribute("data-ordering") === "fence" && num(await lab.getAttribute("data-both_zero")) === 0, "ch11 fence: never both zero");
  // ch12 and ch13: every layout counts exactly, and the comparison runs three layouts.
  await page.goto(base + "cache-coherence.html");
  lab = await settled(0);
  check(num(await lab.getAttribute("data-observed")) === num(await lab.getAttribute("data-expected")) && (await lab.getAttribute("data-layouts")).split(";").length === 3,
    `ch12 compare: three layouts, every count exact (same word took ${await lab.getAttribute("data-ratio")} times as long as a line each here)`);
  await page.goto(base + "false-sharing.html");
  lab = await settled(1);
  check(await lab.getAttribute("data-layout") === "own line" && num(await lab.getAttribute("data-observed")) === num(await lab.getAttribute("data-expected")), "ch13 own line: exact");
  check(errors.length === 0, `no page errors on ch08 to ch15${errors.length ? ": " + errors.join(" | ") : ""}`);
  // ch16: the compare-and-swap stack accounts for every node; the broken pop need not.
  await page.goto(base + "lock-free-stack.html");
  lab = await settled(0);
  check(num(await lab.getAttribute("data-twice")) === 0 && num(await lab.getAttribute("data-lost")) === 0, `ch16 cas: ${await lab.getAttribute("data-popped")} popped, none twice, none lost`);
  lab = await settled(1);
  // The broken pop promises nothing: a corrupted stack can even make the accounting negative.
  check(await lab.getAttribute("data-operation") === "broken" && num(await lab.getAttribute("data-twice")) >= 0, `ch16 broken: ${await lab.getAttribute("data-twice")} popped twice, ${await lab.getAttribute("data-lost")} lost (whatever this device allows)`);
  await lab.locator('.lab-modes button[data-mode="trace"]').click();
  await lab.locator(".stepper button", { hasText: "Run to the end" }).click();
  check((await lab.locator(".stepper").getAttribute("data-trace-outcome")).includes("two owners"), "ch16 trace: the broken pop gives one node two owners");
  // ch17: the tagged head never pops a node that was not in the stack.
  await page.goto(base + "the-aba-problem.html");
  lab = await settled(0);
  check(num(await lab.getAttribute("data-pops")) > 0, `ch17 plain: ${await lab.getAttribute("data-corrupt")} pops of a node not in the stack (whatever this device allows)`);
  lab = await settled(1);
  check(await lab.getAttribute("data-head") === "tagged" && num(await lab.getAttribute("data-corrupt")) === 0 && num(await lab.getAttribute("data-in_stack")) === 3, "ch17 tagged: none, and three nodes at the end");
  // ch18 and ch20: protection stops every poisoned read.
  await page.goto(base + "memory-reclamation.html");
  lab = await settled(1);
  check(await lab.getAttribute("data-protection") === "hazard pointers" && num(await lab.getAttribute("data-poisoned")) === 0, `ch18 hazard pointers: no poisoned read in ${await lab.getAttribute("data-reads")}`);
  await page.goto(base + "rcu.html");
  lab = await settled(1);
  check(num(await lab.getAttribute("data-poisoned")) === 0 && num(await lab.getAttribute("data-waits")) >= 0, `ch20 grace period: no poisoned read in ${await lab.getAttribute("data-reads")}, ${await lab.getAttribute("data-waits")} waits`);
  // ch19: sequenced slots deliver every item once and in order.
  await page.goto(base + "lock-free-queue.html");
  lab = await settled(1);
  check(await lab.getAttribute("data-step") === "sequenced slots" && num(await lab.getAttribute("data-unwritten")) === 0 && num(await lab.getAttribute("data-disordered")) === 0 && num(await lab.getAttribute("data-duplicated")) === 0,
    `ch19 sequenced: ${await lab.getAttribute("data-dequeued")} dequeued, none unwritten, none out of order, none twice`);
  check(errors.length === 0, `no page errors on ch16 to ch20${errors.length ? ": " + errors.join(" | ") : ""}`);
  // ch21: the sweep runs three layouts at several worker counts, every count exact, with a chart each.
  await page.goto(base + "contention-and-scalability.html");
  lab = await settled(0);
  check(await lab.getAttribute("data-exact") === "true" && (await lab.getAttribute("data-layouts")).split(";").length === 3 && await lab.locator("figure.chart svg").count() === 3,
    `ch21: three layouts over workers ${await lab.getAttribute("data-counts")}, every count exact; one shared counter's rate fell ${await lab.getAttribute("data-shared-ratio")} times from one worker to the most`);
  // ch22: every round trip completes, sleeping or spinning.
  await page.goto(base + "webassembly-threads.html");
  lab = await settled(0);
  check(num(await lab.getAttribute("data-rounds")) === 10000 && num(await lab.getAttribute("data-spins")) === 0, `ch22 sleep and wake: 10000 round trips, ${await lab.getAttribute("data-sleeps")} sleeps, ${await lab.getAttribute("data-per_round")} ns each`);
  await lab.locator('select[name="waiting"]').selectOption("spin");
  lab = await settled(0, "waiting=spin");
  check(num(await lab.getAttribute("data-rounds")) === 10000 && num(await lab.getAttribute("data-sleeps")) === 0, `ch22 spin: 10000 round trips, ${await lab.getAttribute("data-per_round")} ns each`);
  // ch23 and ch24 reuse the counter; ch25's office as written oversells, and by compare-and-swap never.
  await page.goto(base + "diagnose-the-race.html");
  lab = await settled(0);
  check(num(await lab.getAttribute("data-booked")) >= num(await lab.getAttribute("data-capacity")), `ch25 as written: oversold by ${await lab.getAttribute("data-oversold")} (whatever this device allows)`);
  lab = await settled(1);
  check(await lab.getAttribute("data-version") === "compare-and-swap" && num(await lab.getAttribute("data-oversold")) === 0, "ch25 compare-and-swap: nothing oversold");
  await lab.locator('.lab-modes button[data-mode="trace"]').click();
  await lab.locator(".stepper button", { hasText: "Run to the end" }).click();
  check((await lab.locator(".stepper").getAttribute("data-trace-outcome")).includes("one booking"), "ch25 trace: by compare-and-swap, one seat, one booking");
  check(errors.length === 0, `no page errors on ch21 to ch25${errors.length ? ": " + errors.join(" | ") : ""}`);
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
