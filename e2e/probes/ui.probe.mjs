// Audit probe (docs/BUGS_AND_FEATURES.md): reproduces the UI-level BUG-xx items
// against the vite dev server with the Master Vault API mocked (page.route), so
// it runs offline and deterministically. Prints one line per scenario with the
// observed evidence; screenshots go to e2e/probes/shots/.
// Usage: node e2e/probes/ui.probe.mjs [--port 5231]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHOTS = join(ROOT, "e2e", "probes", "shots");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 5231;
const BASE = `http://127.0.0.1:${port}/`;
const DEMO_ID = "ec86db52-e41e-4e6a-9f1a-a2d0e3d3277d"; // DEMO_DECK_ID (src/lib/demoDeck.ts)
const HEAL_ID = "11111111-2222-4333-8444-555555555555";

function vaultCard(id, title, text, extra = {}) {
  return { id, card_title: title, house: "Brobnar", card_type: "Creature", card_text: text, amber: 0, power: 6, armor: 0, front_image: "", ...extra };
}
function vaultDeck(id, name, cards) {
  return {
    data: { id, name, expansion: 341, _links: { houses: ["Brobnar"], cards: cards.map((c) => c.id) } },
    _linked: { cards: [...new Map(cards.map((c) => [c.id, c])).values()] },
  };
}
const bosch = vaultCard("bosch", "Bosch the Unyielding", "Taunt.\nAfter Fight: Fully heal Bosch the Unyielding.");
const filler = vaultCard("grunt", "Grunt", "", { power: 3 });
const HEAL_DECK = vaultDeck(HEAL_ID, "Fully Heal Crash Deck", [...Array(12).fill(bosch), ...Array(24).fill(filler)]);
const SYNCED_DEMO = vaultDeck(DEMO_ID, "Synced Demo Deck", Array(36).fill(filler));
const SYNCED_DEMO_OTHER = () => vaultDeck(HEAL_ID, "Imported Without IDB", Array(36).fill(filler));

function startVite() {
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const stop = () => (process.platform === "win32" ? spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }) : child.kill());
  return { stop, async ready() { for (let i = 0; i < 240; i += 1) { try { if ((await fetch(BASE)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error("vite did not start"); } };
}

async function launch() {
  const { chromium } = await import("playwright-core");
  for (const opts of [{ channel: "msedge" }, { channel: "chrome" }]) {
    try { return await chromium.launch({ headless: true, ...opts }); } catch {}
  }
  throw new Error("no system Edge/Chrome");
}

const SEED = `localStorage.setItem("aember-arena-settings", JSON.stringify({difficulty:"Medium",thinkingDepth:2,sfx:false,music:false,animations:false,hoverZoom:false,language:"en"}));localStorage.setItem("aember-arena-language","en");`;

async function fresh(browser, routes = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0]));
  let listRequests = 0;
  await page.route("https://www.keyforgegame.com/api/decks/**", (route) => {
    const url = route.request().url();
    const hit = Object.entries(routes).find(([id]) => url.includes(id));
    if (hit) return route.fulfill({ json: hit[1] });
    if (url.includes("/api/decks/?")) {
      listRequests += 1;
      const decks = Array.from({ length: 9 }, (_, i) => vaultDeck(`aaaaaaaa-0000-4000-8000-00000000000${i}`, `Browse Deck ${i}`, Array(36).fill(filler)));
      return route.fulfill({ json: { count: 90, data: decks.map((d) => d.data), _linked: { cards: [filler] } } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(BASE);
  await page.evaluate(SEED);
  await page.reload();
  await page.waitForSelector(".home-screen");
  return { context, page, errors, listRequests: () => listRequests };
}

const nav = (page, i) => page.locator(".header-nav .nav-link").nth(i).click();
async function startMatch(page) {
  await nav(page, 2);
  await page.locator(".config-screen .config-step-pill").nth(3).click();
  await page.locator(".config-screen .cta-button").click();
  await page.waitForSelector(".game-screen");
}
const report = (id, ok, detail) => console.log(`${ok ? "REPRODUCED" : "not reproduced"}  ${id}  ${detail}`);

const vite = startVite();
let browser;
try {
  mkdirSync(SHOTS, { recursive: true });
  await vite.ready();
  browser = await launch();

  { // BUG-02: before choosing a house the inspector offers Play on any card.
    const { context, page } = await fresh(browser);
    await startMatch(page);
    const handBefore = await page.locator(".hand-track .card-tile").count();
    await page.locator(".hand-track .card-tile").first().click();
    const button = page.locator(".inspector-actions .primary-action").first();
    const enabled = await button.isEnabled();
    const label = (await button.innerText()).trim();
    if (enabled) await button.click();
    await page.waitForTimeout(400);
    const handAfter = await page.locator(".hand-track .card-tile").count();
    const house = (await page.locator(".turn-console-copy span").last().innerText()).trim();
    await page.screenshot({ path: join(SHOTS, "bug-02-play-before-house.png") });
    report("BUG-02", enabled && handAfter < handBefore, `button "${label}" enabled=${enabled}; hand ${handBefore} -> ${handAfter}; turn console: "${house}"`);
    await context.close();
  }

  { // BUG-03: leaving the board during the AI turn freezes the match.
    const { context, page } = await fresh(browser);
    await startMatch(page);
    await page.locator(".end-turn-button").click();
    await page.waitForTimeout(150);
    await nav(page, 2);
    await page.waitForTimeout(600);
    await nav(page, 3);
    await page.waitForTimeout(15000);
    const stuck = await page.locator(".end-turn-button").isDisabled();
    const console_ = (await page.locator(".turn-console-copy strong").innerText()).trim();
    await page.screenshot({ path: join(SHOTS, "bug-03-ai-softlock.png") });
    report("BUG-03", stuck, `15 s after returning: end turn disabled=${stuck}; console "${console_}"`);
    await context.close();
  }

  { // BUG-01: a vault deck with "Fully heal" crashes the match (white screen).
    const { context, page, errors } = await fresh(browser, { [HEAL_ID]: HEAL_DECK });
    await page.locator(".home-shortcuts .import-card").nth(1).click();
    await page.fill("#deck-id", HEAL_ID);
    await page.locator(".deck-import-form button[type=submit]").click();
    await page.locator(".use-deck-button").click();
    // The crash happens while the board mounts, so .game-screen never appears.
    await startMatch(page).catch(() => undefined);
    const rootChildren = await page.evaluate(() => document.getElementById("root")?.childElementCount ?? -1);
    await page.screenshot({ path: join(SHOTS, "bug-01-fully-heal-crash.png") });
    report("BUG-01", rootChildren === 0, `#root children=${rootChildren}; pageerror: ${errors[0] ?? "none"}`);
    await context.close();
  }

  { // BUG-05: Sync on Home replaces the deck the player selected with currentDeck.
    const { context, page } = await fresh(browser, { [DEMO_ID]: SYNCED_DEMO });
    await page.locator(".deck-grid .tile-action--primary").nth(1).click();
    const before = (await page.locator(".home-cta-deck strong").innerText()).trim();
    await page.locator(".header-button--sync").click();
    await page.waitForTimeout(3000);
    const after = (await page.locator(".home-cta-deck strong").innerText()).trim();
    const toast = (await page.locator(".toast-message").innerText().catch(() => "")).trim();
    report("BUG-05", before !== after, `selected before sync "${before}" -> after "${after}"; toast "${toast}"`);
    await context.close();
  }

  { // BUG-14: switching language on Browse refetches the page from the network.
    const { context, page, listRequests } = await fresh(browser);
    await nav(page, 1);
    await page.waitForSelector(".deck-grid--browse");
    const before = listRequests();
    await page.locator(".app-header .lang-trigger").click();
    await page.locator(".lang-option").nth(1).click();
    await page.waitForTimeout(800);
    report("BUG-14", listRequests() > before, `vault list requests: ${before} -> ${listRequests()} after changing language`);
    await context.close();
  }

  { // BUG-15: Browse -> Explore deck -> Back loses page and search.
    const { context, page } = await fresh(browser);
    await nav(page, 1);
    await page.waitForSelector(".deck-grid--browse");
    await page.locator(".browse-pager button", { hasText: "3" }).first().click();
    await page.waitForSelector(".deck-grid--browse");
    const before = (await page.locator(".status-page").innerText()).trim();
    await page.locator(".deck-grid--browse .tile-action").nth(1).click();
    await page.waitForSelector(".inspect-screen");
    await page.locator(".inspect-screen .icon-back").click();
    await page.waitForSelector(".deck-grid--browse");
    const after = (await page.locator(".status-page").innerText()).trim();
    report("BUG-15", before !== after, `browse "${before}" -> after back "${after}"`);
    await context.close();
  }

  { // BUG-13: every deck merely listed in Browse lands in the Home library.
    const { context, page } = await fresh(browser);
    const before = (await page.locator(".deck-list-count").innerText()).trim();
    await nav(page, 1);
    await page.waitForSelector(".deck-grid--browse");
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector(".home-screen");
    await page.waitForTimeout(800);
    const after = (await page.locator(".deck-list-count").innerText()).trim();
    report("BUG-13", before !== after, `Home library "${before}" -> after opening Browse once and reloading "${after}"`);
    await context.close();
  }

  { // BUG-16: without IndexedDB an imported deck is saved to localStorage but never listed again.
    const { context, page } = await fresh(browser, { [HEAL_ID]: SYNCED_DEMO_OTHER() });
    await context.addInitScript(() => { Object.defineProperty(window, "indexedDB", { value: undefined }); });
    await page.reload();
    await page.waitForSelector(".home-screen");
    await page.locator(".home-shortcuts .import-card").nth(1).click();
    await page.fill("#deck-id", HEAL_ID);
    await page.locator(".deck-import-form button[type=submit]").click();
    await page.locator(".use-deck-button").click();
    const before = (await page.locator(".deck-list-count").innerText()).trim();
    const stored = await page.evaluate((id) => Boolean(localStorage.getItem(`keyforge-deck-${id}`)), HEAL_ID);
    await page.reload();
    await page.waitForSelector(".home-screen");
    await page.waitForTimeout(800);
    const after = (await page.locator(".deck-list-count").innerText()).trim();
    report("BUG-16", before !== after && stored, `IndexedDB off: library "${before}" (localStorage copy=${stored}) -> after reload "${after}"`);
    await context.close();
  }
} finally {
  await browser?.close();
  vite.stop();
}
