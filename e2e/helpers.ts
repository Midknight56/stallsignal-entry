import { expect, type Page, type APIRequestContext } from '@playwright/test';
import type { CampaignView, Preorder, ProductId, VenueId } from '../src/shared/types';
import { approve } from '../tools/buyer.mjs';
import { pauseForBuyer, resumeAfterBuyer } from './payment-test';

export const base = process.env.SS_BASE || 'http://127.0.0.1:8799';
export async function api<T = CampaignView>(
  request: APIRequestContext,
  route: string,
  data?: unknown,
): Promise<T> {
  const response =
    data === undefined
      ? await request.get(`${base}${route}`)
      : await request.post(`${base}${route}`, { data });
  expect(response.ok(), `${route}: HTTP ${response.status()}`).toBe(true);
  return response.json();
}
export const campaign = (page: Page) => api(page.request, '/api/campaign');
export async function fault(page: Page, kind: string) {
  await api(page.request, '/api/dev/fault', { kind });
}
export async function openMap(page: Page, mock = false) {
  await page.goto(`${base}/?nosweep=1${mock ? '&mock=1' : ''}`);
  await expect(page.getByRole('img', { name: 'Portland, Maine', exact: true })).toBeVisible();
  await expect(page.locator('.venue-pin')).toHaveCount(3);
  await expect(page.locator('.decision')).toContainText(/Forecast picks|Preorders pick/);
}
export async function startPreorder(
  page: Page,
  venue: VenueId = 'mill',
  product: ProductId = 'tin',
  qty = 1,
) {
  await openMap(page);
  await page.getByRole('button', { name: 'Preorder at this venue', exact: true }).click();
  await page.getByLabel('Venue', { exact: true }).selectOption(venue);
  await page.getByLabel('Product', { exact: true }).selectOption(product);
  await page.getByLabel('Quantity', { exact: true }).selectOption(String(qty));
  // A reused PayPal login can show the buyer email as soon as checkout opens.
  await pauseForBuyer(page.context());
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/preorders' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Pay with PayPal', exact: true }).click();
  await response;
  await page.waitForURL(
    (url) =>
      url.protocol === 'https:' &&
      (url.hostname === 'sandbox.paypal.com' || url.hostname.endsWith('.sandbox.paypal.com')),
    { waitUntil: 'domcontentloaded', timeout: 45_000 },
  );
  const live = await campaign(page);
  const preorder = live.preorders.filter((p) => p.source === 'live').at(-1);
  expect(preorder, 'Newest live preorder after PayPal checkout').toBeDefined();
  return { preorder: preorder!, approveUrl: page.url() };
}
export async function approveBuyer(page: Page, url: string) {
  // Trace action arguments include credentials. Stop recording BEFORE any login operation.
  await pauseForBuyer(page.context());
  try {
    await approve(page, url);
  } finally {
    // Restart only on our app. A challenge/error on PayPal remains unrecorded.
    if (new URL(page.url()).origin === new URL(base).origin) await resumeAfterBuyer(page.context());
  }
}
export async function placePreorder(
  page: Page,
  venue: VenueId = 'mill',
  options: { fault?: string; product?: ProductId; qty?: number } = {},
) {
  const created = await startPreorder(page, venue, options.product, options.qty);
  // Faults must be armed AFTER order creation, since lose_next_response targets the next write.
  if (options.fault) await fault(page, options.fault);
  await approveBuyer(page, created.approveUrl);
  return created.preorder;
}
export async function waitPayment(page: Page, id: string, states: string[]) {
  await expect
    .poll(async () => (await campaign(page)).preorders.find((p) => p.id === id)?.state, { timeout: 120_000 })
    .toMatch(new RegExp(`^(${states.join('|')})$`));
  return (await campaign(page)).preorders.find((p) => p.id === id)!;
}
export async function closeWith(page: Page, venue: VenueId = 'mill') {
  await page.goto(`${base}/campaign`);
  await page.getByLabel('Chosen venue').selectOption(venue);
  await page.getByRole('button', { name: 'Close campaign', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm close', exact: true }).click();
  await expect.poll(async () => (await campaign(page)).state, { timeout: 120_000 }).toBe('closed');
}
export function browserErrors(page: Page) {
  const errors: string[] = [];
  const app = (url: string) => {
    try {
      return new URL(url).origin === new URL(base).origin;
    } catch {
      return false;
    }
  };
  page.on('pageerror', (error) => {
    if (app(page.url())) errors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && app(page.url()) && !isAgStudioTrialBoxLine(message.text()))
      errors.push(message.text());
  });
  return errors;
}
export function isAgStudioTrialBoxLine(message: string) {
  const line = message.replace(/^[* ]+|[* ]+$/g, '');
  return (
    line === '' ||
    line === 'AG Studio Pro with AI License' ||
    line === 'License Key Not Found' ||
    line === 'All AG Studio Pro with AI features are unlocked for trial.' ||
    line.startsWith('If you want to hide the watermark please email ')
  );
}
export async function noHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `Horizontal page scroll at ${new URL(page.url()).pathname}`,
  ).toBe(true);
}
export async function phoneLayout(page: Page) {
  await noHorizontalScroll(page);
  const failures = await page.evaluate(() => {
    const results: string[] = [];
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>('button, a.button, [role="button"]'),
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      if (!(
        r.width > 0 &&
        r.height > 0 &&
        getComputedStyle(el).visibility !== 'hidden' &&
        r.bottom > 0 &&
        r.top < innerHeight &&
        r.right > 0 &&
        r.left < innerWidth
      ))
        return false;
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor),
          a = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.bottom <= a.top || r.top >= a.bottom))
          return false;
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (r.right <= a.left || r.left >= a.right))
          return false;
      }
      return true;
    });
    // Buttons in the same scrolling panel move together, so their real gap counts. A button in another panel (the
    // sheet handle above a scrolled list) is measured against the part of the list button the visitor can see.
    const scroller = (el: HTMLElement) => {
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement)
        if (/(auto|scroll)/.test(getComputedStyle(ancestor).overflowY)) return ancestor;
      return null;
    };
    const visible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      let top = r.top,
        bottom = r.bottom;
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowY)) continue;
        const a = ancestor.getBoundingClientRect();
        top = Math.max(top, a.top);
        bottom = Math.min(bottom, a.bottom);
      }
      return { left: r.left, right: r.right, top, bottom };
    };
    const name = (el: HTMLElement) =>
      el.getAttribute('aria-label') ||
      el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100) ||
      el.tagName;
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i],
        r = el.getBoundingClientRect();
      if (r.left < 16 - 0.5 || r.right > innerWidth - 16 + 0.5)
        results.push(
          `${name(el)}: button must be 16px inside viewport (left ${r.left.toFixed(1)}, right ${r.right.toFixed(1)}).`,
        );
      if (el.scrollWidth > el.clientWidth)
        results.push(`${name(el)}: text overflow (${el.scrollWidth} > ${el.clientWidth}).`);
      for (const other of elements.slice(i + 1)) {
        if (el.contains(other) || other.contains(el)) continue;
        const same = scroller(el) === scroller(other);
        const v = same ? r : visible(el);
        const s = same ? other.getBoundingClientRect() : visible(other);
        const dx = Math.max(s.left - v.right, v.left - s.right, 0);
        const dy = Math.max(s.top - v.bottom, v.top - s.bottom, 0);
        if (Math.hypot(dx, dy) < 12 - 0.5)
          results.push(
            `${name(el)} / ${name(other)}: neighbouring buttons have ${Math.hypot(dx, dy).toFixed(1)}px gap; need 12px.`,
          );
      }
    }
    return results;
  });
  return failures;
}
