// The StallSignal film tour: one take in the maker's browser and one in a separate buyer's browser.
//   SS_BASE=https://stallsignal.midknight-labs.workers.dev node tools/film_tour.mjs
// Writes tools/out/video/tour.webm (maker), tour-buyer.webm (buyer) and tour-times.json (beat times in seconds
// from each video's first frame, the boxes to show closer, and the texts the captions quote).
// Every payment is a real PayPal sandbox call made through the app. No login and no card number appear on screen.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { api, base, root, waitCampaign } from './runtime.mjs';

const videoDir = path.join(root, 'tools', 'out', 'video');
const makerDir = path.join(videoDir, 'maker');
const buyerDir = path.join(videoDir, 'buyer');
const timesFile = path.join(videoDir, 'tour-times.json');
for (const dir of [videoDir, makerDir, buyerDir]) fs.mkdirSync(dir, { recursive: true });
for (const dir of [makerDir, buyerDir])
  for (const name of fs.readdirSync(dir)) if (name.endsWith('.webm')) fs.rmSync(path.join(dir, name));

const PRODUCT_LABEL = /trio/i; // the What changes list and the buyer use the same product and quantity
const QTY = '3';
const WINNER = 'mill';

const browser = await chromium.launch({ headless: true });
// The app lays out at 1280 x 720 and is zoomed to fill the frame with sharp text. Studio is a wide dashboard: 1.25.
// A headless recording shows no pointer, so the film draws a small dot where the mouse is. It is not part of the app.
const overlay = () => {
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.zoom = location.pathname.startsWith('/studio') ? '1.25' : '1.5';
    const dot = document.createElement('div');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText =
      'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'background:rgba(19,38,63,.55);border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35);' +
      'pointer-events:none;z-index:2147483647;transition:transform .12s;display:none';
    document.body.appendChild(dot);
    const zoom = () => Number(document.documentElement.style.zoom || 1);
    addEventListener('mousemove', (e) => {
      dot.style.display = 'block';
      dot.style.left = `${e.clientX / zoom()}px`;
      dot.style.top = `${e.clientY / zoom()}px`;
    }, true);
    addEventListener('mousedown', () => (dot.style.transform = 'scale(.7)'), true);
    addEventListener('mouseup', () => (dot.style.transform = ''), true);
  });
};
const recorded = async (dir, storageState) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir, size: { width: 1920, height: 1080 } },
    reducedMotion: 'no-preference',
    ...(storageState ? { storageState } : {}),
  });
  await context.addInitScript(overlay);
  return context;
};

// Shared page helpers, bound to one page and one clock.
function driver(page, marks) {
  const t0 = Date.now();
  const wait = (ms) => page.waitForTimeout(ms);
  const mark = (name) => {
    marks[name] = Number(((Date.now() - t0) / 1000).toFixed(2));
    console.log(`${marks[name].toFixed(1).padStart(6)}  ${name}`);
  };
  async function scrollTo(locator, block = 'center') {
    await locator.waitFor({ state: 'visible', timeout: 30_000 });
    await locator.evaluate((el, b) => el.scrollIntoView({ behavior: 'smooth', block: b }), block);
    await wait(900);
  }
  async function moveTo(locator) {
    await scrollTo(locator);
    const b = await locator.boundingBox();
    if (!b) throw new Error('Target is not on screen.');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
    return b;
  }
  async function click(locator) {
    await moveTo(locator);
    await wait(250);
    await locator.click();
  }
  async function go(route, ready) {
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await ready.waitFor({ state: 'visible', timeout: 30_000 });
  }
  async function nav(name, ready) {
    const link = page.getByRole('navigation').getByRole('link', { name, exact: true }).first();
    if (await link.count()) {
      await click(link);
      await ready.waitFor({ state: 'visible', timeout: 30_000 });
    } else await go(`/${name.toLowerCase()}`, ready);
  }
  return { t0, wait, mark, scrollTo, moveTo, click, go, nav };
}
const boxes = {};
async function grab(name, locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`No box for ${name}`);
  boxes[name] = [b.x, b.y, b.width, b.height].map((v) => Math.round(v));
}
async function grabUnion(name, locators) {
  const all = [];
  for (const l of locators) {
    const b = (await l.count()) ? await l.first().boundingBox() : null;
    if (b) all.push(b);
  }
  if (!all.length) throw new Error(`No box for ${name}`);
  const x = Math.min(...all.map((b) => b.x)),
    y = Math.min(...all.map((b) => b.y)),
    r = Math.max(...all.map((b) => b.x + b.width)),
    btm = Math.max(...all.map((b) => b.y + b.height));
  boxes[name] = [x, y, r - x, btm - y].map((v) => Math.round(v));
}
async function pickProduct(select) {
  const value = await select
    .locator('option')
    .evaluateAll((options, re) => options.find((o) => new RegExp(re, 'i').test(o.textContent ?? ''))?.getAttribute('value'), PRODUCT_LABEL.source);
  if (value) await select.selectOption(value);
}
// The panel's What changes section, set to this campaign only and the film's product and quantity.
async function setChanges(page) {
  const changes = page.getByLabel('What changes the choice?', { exact: true }).first();
  await changes.waitFor({ timeout: 30_000 });
  const only = changes.getByText('This campaign only', { exact: true });
  if (await only.count()) await only.click();
  await pickProduct(changes.getByRole('combobox').filter({ has: page.locator('option', { hasText: PRODUCT_LABEL }) }).first());
  const qty = changes.getByRole('combobox').filter({ has: page.locator('option[value="3"]') }).last();
  await qty.selectOption(QTY);
  return changes;
}
const winnerLine = async (changes) =>
  ((await changes.locator('li, p').filter({ hasText: 'Millrace Hall' }).first().innerText().catch(() => '')) || '').trim();
const ordersIn = (line) => Number((line.match(/after (\d+) more order/) || [])[1] || NaN);

// Setup, not filmed: two card orders at the venues that will lose, then enough orders at Millrace Hall that exactly
// one more order of the film's size flips the pick on this campaign alone. All in the maker's own visitor session.
const setup = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await api(setup.request, '/api/campaign');
const seeded = [];
for (const venue of ['wharf', 'linden']) {
  const made = await api(setup.request, '/api/preorders', { venue, product: 'tin', qty: 1, method: 'card' });
  if (made.preorder?.state !== 'captured') throw new Error(`Setup order at ${venue} is ${made.preorder?.state}`);
  seeded.push(venue);
}
const probe = await setup.newPage();
await probe.goto(`${base}/?nosweep=1`, { waitUntil: 'networkidle' });
const BUDGET = '45000'; // the agent's budget in the film
// The threshold part runs at $900: there the forecast picks Shed 9, so paid demand can move the pick away from it.
// At $450 the forecast already picks Millrace Hall.
const THRESHOLD_BUDGET = '90000';
await probe.locator('#budget').fill(THRESHOLD_BUDGET);
let line = await winnerLine(await setChanges(probe));
let need = ordersIn(line);
if (!Number.isFinite(need)) throw new Error(`Could not read the What changes line: "${line}"`);
const product = (await probe.locator('select[aria-label="Product"] option, option').filter({ hasText: PRODUCT_LABEL }).first().getAttribute('value')) ?? 'trio';
for (let i = 1; i < need; i += 1) {
  const made = await api(setup.request, '/api/preorders', { venue: WINNER, product, qty: Number(QTY), method: 'card' });
  if (made.preorder?.state !== 'captured') throw new Error(`Setup order ${i} at ${WINNER} is ${made.preorder?.state}`);
  seeded.push(WINNER);
}
await probe.reload({ waitUntil: 'networkidle' });
await probe.locator('#budget').fill(THRESHOLD_BUDGET);
line = await winnerLine(await setChanges(probe));
if (ordersIn(line) !== 1) throw new Error(`After setup the line should say 1 more order: "${line}"`);
const state = await setup.storageState();
await setup.close();

const marks = {};
const buyerMarks = {};
const sources = { seeded: seeded.length, before: line };
const errors = [];
let failure = null;
const maker = await recorded(makerDir, state);
const buyer = await recorded(buyerDir);
const page = await maker.newPage();
page.on('pageerror', (e) => errors.push(`maker: ${e.message || e}`));
const M = driver(page, marks);
try {
  // 0:00 to 0:12. The map on the forecast side.
  await M.go('/?nosweep=1', page.locator('.venue-pin').first());
  const handle = page.getByRole('slider', { name: 'Forecast and preorders comparison' });
  await handle.evaluate((el) => el.focus({ preventScroll: true }));
  await page.keyboard.press('Home');
  await handle.evaluate((el) => el.blur());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.decision', { hasText: 'Forecast picks' }).waitFor({ timeout: 10_000 });
  await M.wait(1_500);
  M.mark('map');
  await M.wait(11_000);
  // 0:12 to 0:27. The line moves to the paid side, then the decision up close.
  await handle.evaluate((el) => el.focus({ preventScroll: true }));
  M.mark('sweep_start');
  for (let i = 0; i < 45; i += 1) {
    await page.keyboard.press('ArrowRight');
    await M.wait(120);
  }
  await handle.evaluate((el) => el.blur());
  M.mark('sweep_end');
  const block = page.locator('.decision-block').first();
  const decision = (await block.count()) ? block : page.locator('.decision').first();
  await M.scrollTo(decision);
  const decisionParts = [page.locator('.decision-block .decision'), page.locator('.decision-block .decision-cost')];
  await grabUnion('decision', decisionParts);
  M.mark('decision');
  await M.wait(9_500);

  // 0:27 to 0:44. Budget $450, ask the agent.
  const slider = page.locator('#budget');
  await M.moveTo(slider);
  await slider.fill(BUDGET);
  M.mark('budget_set');
  await M.wait(2_800);
  const ask = page.getByRole('button', { name: 'Ask the agent', exact: true });
  await M.moveTo(ask);
  const answered = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/agent' && r.request().method() === 'POST',
    { timeout: 90_000 },
  );
  M.mark('agent_click');
  await ask.click();
  await answered;
  await page.locator('.agent-panel .source').waitFor({ timeout: 30_000 });
  M.mark('agent_answer');
  const answer = page.locator('.agent-panel [aria-live="polite"]').first();
  await M.scrollTo(answer, 'start');
  await grab('agent', answer);
  boxes.agent[3] = Math.min(boxes.agent[3], 620); // the source, the steps and the start of the plan
  sources.agent = (await page.locator('.agent-panel .source').innerText()).trim().split('.')[0].trim() === 'Live AI'
    ? 'Live AI'
    : (await page.locator('.agent-panel .source').innerText()).trim();
  sources.budget = (await page.locator('label[for="budget"] strong').innerText()).trim().replace(/\.00$/, '');
  sources.stock = (await answer.locator('tfoot td').last().innerText()).trim().replace(/\.00$/, '');
  await M.wait(5_000);
  // Then the stock plan and its total under the budget.
  const plan = answer.locator('table').last();
  await M.scrollTo(plan, 'center');
  await grab('stock', plan);
  M.mark('agent_stock');
  await M.wait(5_000);
  M.mark('agent_done');

  // 0:44 to 1:04. The threshold now, then the buyer link.
  await page.locator('#budget').fill(THRESHOLD_BUDGET);
  const changes = await setChanges(page);
  await M.scrollTo(changes);
  await M.wait(600);
  await grab('changes', changes);
  sources.before = await winnerLine(changes);
  if (ordersIn(sources.before) !== 1) throw new Error(`Before the payment the line should say 1 more order: "${sources.before}"`);
  M.mark('changes_before');
  await M.wait(4_500);
  await M.nav('Campaign', page.getByRole('heading', { name: 'Your campaign' }));
  const create = page.getByRole('button', { name: 'Create buyer link', exact: true });
  await M.click(create);
  const link = page.locator('a[href*="/c/"], input[value*="/c/"], code').filter({ hasText: /\/c\// }).first();
  await page.getByRole('button', { name: /Copy link|Copied/ }).waitFor({ timeout: 30_000 });
  M.mark('share');
  const shareUrl = (await page.evaluate(() => {
    const text = document.body.innerText.match(/https?:\/\/\S+\/c\/[a-f0-9]{32}/);
    return text ? text[0] : null;
  })) ?? (await link.innerText().catch(() => null));
  if (!shareUrl) throw new Error('The buyer link was not shown.');
  await M.wait(4_000);

  // The buyer's own browser, its own cookies.
  const bpage = await buyer.newPage();
  bpage.on('pageerror', (e) => errors.push(`buyer: ${e.message || e}`));
  const B = driver(bpage, buyerMarks);
  await bpage.goto(shareUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await bpage.getByRole('heading', { name: 'Preorder for the December popup' }).waitFor({ timeout: 30_000 });
  await B.wait(800);
  B.mark('open');
  await B.wait(3_500);
  const venue = bpage.getByLabel('Venue', { exact: true });
  await B.moveTo(venue);
  await venue.selectOption(WINNER);
  await B.wait(700);
  B.mark('choose');
  await pickProduct(bpage.getByLabel('Product', { exact: true }));
  await B.wait(600);
  await bpage.getByLabel('Quantity', { exact: true }).selectOption(QTY);
  await B.wait(3_500);
  const pay = bpage.getByRole('button', { name: 'Pay with test card', exact: true });
  await B.moveTo(pay);
  B.mark('pay_click');
  await pay.click();
  const paid = bpage.locator('.receipt').filter({ hasText: 'Paid' }).first();
  await paid.waitFor({ timeout: 90_000 });
  await B.scrollTo(paid);
  B.mark('paid');
  await grab('receipt', paid);
  await B.wait(6_000);
  B.mark('paid_done');
  await B.wait(1_000);

  // 1:04 to 1:17. The maker sees the buyer's units.
  // Open Campaign again inside the page (a reload would put the budget back to $900 anyway, but keeps nothing else).
  await M.nav('Receipts', page.getByRole('heading', { name: 'Recorded sandbox run' }));
  await M.nav('Campaign', page.getByRole('heading', { name: 'Your campaign' }));
  await page.getByText('Buyer', { exact: true }).first().waitFor({ timeout: 60_000 });
  await M.scrollTo(page.locator('.totals').first());
  M.mark('maker_units');
  await M.wait(5_500);

  // 1:17 to 1:32. Back on the map: the same threshold, crossed.
  await M.nav('Map', page.locator('.venue-pin').first());
  await setChanges(page);
  await M.scrollTo(changes);
  await M.wait(600);
  await grab('changes_after', changes);
  sources.after = await winnerLine(changes);
  M.mark('changes_after');
  await M.wait(2_500);
  await M.scrollTo(decision);
  await grabUnion('decision_after', decisionParts);
  sources.decisionAfter = (await page.locator('.decision-block .decision').innerText()).trim();
  M.mark('decision_after');
  await M.wait(6_500);

  // 1:32 to 1:54. Close with Millrace Hall. Each losing payment gets its own refund.
  await M.nav('Campaign', page.getByRole('heading', { name: 'Your campaign' }));
  const chosen = page.getByLabel('Chosen venue');
  await M.moveTo(chosen);
  await chosen.selectOption(WINNER);
  await M.wait(900);
  await M.click(page.getByRole('button', { name: 'Close campaign', exact: true }));
  await M.wait(800);
  const confirm = page.getByRole('button', { name: 'Confirm close', exact: true });
  await M.moveTo(confirm);
  M.mark('close_click');
  await confirm.click();
  await page.locator('.refund-row').first().waitFor({ timeout: 60_000 });
  await M.scrollTo(page.locator('.refund-row').first());
  M.mark('refund_rows');
  await waitCampaign(
    maker.request,
    (c) => c.state === 'closed' && c.preorders.filter((p) => p.venue !== WINNER).every((p) => p.state === 'refunded'),
    120_000,
  );
  await page.reload({ waitUntil: 'networkidle' });
  const refunds = page.locator('section').filter({ has: page.getByRole('heading', { name: /Each payment.s refund/ }) }).first();
  await M.scrollTo(refunds, 'start');
  await grab('refunds', refunds);
  M.mark('refunded');
  await M.wait(9_500);

  // 1:54 to 2:08. Proof.
  await M.nav('Proof', page.getByRole('heading', { name: 'Payment guard proofs' }));
  await page.waitForFunction(() => document.querySelectorAll('.proof-row .chip.held').length >= 6, null, { timeout: 60_000 });
  // One proof first, readable: the lost answer. Then all six results.
  await M.scrollTo(page.locator('.proof-row').first(), 'center');
  M.mark('proof');
  await M.wait(9_000);
  await M.scrollTo(page.locator('.proof-row').last(), 'end');
  M.mark('proof_held');
  await M.wait(6_000);

  // 2:08 to 2:27. Studio: linked widgets, then the new chart.
  await M.go('/studio', page.getByRole('heading', { name: /studio/i }));
  M.mark('studio');
  await M.wait(2_000);
  await M.click(
    page.getByRole('region', { name: 'Venue map', exact: true }).getByRole('button', { name: 'Select Millrace Hall on map', exact: true }),
  );
  M.mark('studio_select');
  await M.wait(4_000);
  await M.click(
    page.getByRole('region', { name: 'Venue map', exact: true }).getByRole('button', { name: 'Select Millrace Hall on map', exact: true }),
  );
  await M.wait(1_200);
  const question = page.locator('#studio-question');
  await M.click(question);
  await question.pressSequentially('Chart refunds by venue', { delay: 70 });
  await M.wait(400);
  await M.moveTo(page.locator('.studio-ask-line button[type="submit"]'));
  M.mark('studio_ask');
  await page.locator('.studio-ask-line button[type="submit"]').click();
  await page.locator('.studio-answer').waitFor({ timeout: 60_000 });
  await M.wait(2_500); // the page scrolls to the new widget and focuses its title
  // The page focuses the new widget's title. Show the band under it, across the frame.
  const title = await page.locator(':focus').boundingBox();
  if (title) boxes.chart = [0, Math.max(0, Math.round(title.y) - 30), 1920, 500];
  sources.studio = (await page.locator('.studio-answer').innerText()).trim();
  M.mark('studio_chart');
  await M.wait(7_500);

  // 2:27 to 2:42. Scorecard: this campaign's card.
  await M.go('/scorecard', page.getByRole('heading', { name: 'Closed campaigns', exact: true }));
  const campaignId = (await waitCampaign(maker.request, () => true, 5_000).catch(() => null))?.id;
  const cards = page.locator('article.card').filter({ hasText: 'Sandbox campaign' });
  const card = campaignId
    ? cards.filter({ hasText: `${campaignId.slice(0, 4)}…${campaignId.slice(-4)}` }).first()
    : cards.first();
  const target = (await card.count()) ? card : cards.first();
  await M.scrollTo(target);
  await grab('scorecard', target);
  sources.scorecard = (await target.innerText()).trim();
  M.mark('scorecard');
  await M.wait(13_500);

  // 2:42 to 2:50. The map again: the address and no login.
  await M.go('/?nosweep=1', page.locator('.venue-pin').first());
  await page.evaluate(() => window.scrollTo(0, 0));
  M.mark('end');
  await M.wait(9_000);
} catch (error) {
  failure = error;
} finally {
  await maker.close();
  await buyer.close();
  await browser.close();
  for (const [dir, name] of [[makerDir, 'tour.webm'], [buyerDir, 'tour-buyer.webm']]) {
    const file = fs.readdirSync(dir).filter((f) => f.endsWith('.webm'))
      .map((f) => path.join(dir, f))
      .sort((a, z) => fs.statSync(z).size - fs.statSync(a).size)[0];
    if (file) fs.renameSync(file, path.join(videoDir, name));
  }
  fs.writeFileSync(
    timesFile,
    `${JSON.stringify({ base, at: new Date().toISOString(), marks, buyer: buyerMarks, boxes, sources, errors }, null, 2)}\n`,
  );
}
console.log(`video: ${path.join(videoDir, 'tour.webm')} and tour-buyer.webm`);
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
if (failure) {
  console.error(`tour failed: ${failure.message}`);
  process.exitCode = 1;
}
