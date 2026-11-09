import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isMain, launchOptions, root, sleep } from './runtime.mjs';

function sandbox(url) {
  const u = new URL(url);
  return (
    u.protocol === 'https:' &&
    (u.hostname === 'sandbox.paypal.com' || u.hostname.endsWith('.sandbox.paypal.com'))
  );
}

async function credentials() {
  const file = path.join(
    process.env.SS_SECRETS_DIR || path.join(os.homedir(), '.cloudflare'),
    'paypal-sandbox.local.txt',
  );
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error('Sandbox buyer credentials file is unavailable.');
  }
  const kv = Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trimStart().startsWith('#') && line.includes('='))
      .map((line) => {
        const i = line.indexOf('=');
        return [
          line.slice(0, i).trim(),
          line
            .slice(i + 1)
            .trim()
            .replace(/^(["'])(.*)\1$/, '$2'),
        ];
      }),
  );
  const suffix = process.env.BUYER && process.env.BUYER !== '1' ? process.env.BUYER : '';
  if (suffix && !/^[2-9]\d*$/.test(suffix)) throw new Error('BUYER must be a positive buyer number.');
  const email = kv[`PAYPAL_SANDBOX_BUYER${suffix}_EMAIL`];
  const password = kv[`PAYPAL_SANDBOX_BUYER${suffix}_PASSWORD`];
  if (!email || !password) throw new Error('Sandbox buyer email or password is missing.');
  return { email, password };
}

export async function challenge(page) {
  for (const frame of page.frames()) {
    try {
      const paypalFrame = sandbox(frame.url());
      const body = paypalFrame
        ? await frame.locator('body').innerText({ timeout: 1000 })
        : '';
      const recaptcha = frame.locator('iframe[src*="recaptcha"]');
      let visibleRecaptcha = false;
      for (let i = 0; i < (await recaptcha.count()); i++) {
        const iframe = recaptcha.nth(i);
        const src = await iframe.getAttribute('src').catch(() => '');
        const box = await iframe.boundingBox().catch(() => null);
        if (
          (await iframe.isVisible().catch(() => false)) &&
          (src?.includes('bframe') || (box?.width >= 100 && box?.height >= 100))
        ) {
          visibleRecaptcha = true;
          break;
        }
      }
      const visibleCode = paypalFrame && (await frame
        .locator('input[autocomplete="one-time-code"]')
        .evaluateAll((inputs) => inputs.some((input) => {
          const rect = input.getBoundingClientRect();
          const style = getComputedStyle(input);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        })));
      if (/security (?:challenge|check)|captcha|verify (?:your identity|you are human|it's you)|i.?m not a robot|enter (?:the |your )?(?:(?:security|verification) )?code|one.time (?:passcode|code)|unusual activity|confirm (?:your|it's you)|authentication required/i.test(body) || visibleRecaptcha || visibleCode) {
        throw new Error('PayPal showed a security challenge. A person must complete it; buyer stopped.');
      }
    } catch (error) {
      if (error.message?.includes('security challenge')) throw error;
      // Frames can detach as PayPal redirects; their checks are intentionally best effort.
    }
  }
}

async function visible(page, locator, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await challenge(page);
    if (await locator.isVisible().catch(() => false)) return;
    await sleep(400);
  }
  throw new Error('PayPal did not show the expected next step before the timeout.');
}

// Only called after login. Mask inputs and all visible email text, including signed-in account menus.
async function shot(page, run, step, email) {
  const out = path.join(root, 'tools/out/shots');
  await mkdir(out, { recursive: true });
  const mask = page
    .frames()
    .flatMap((frame) => [
      frame.locator('input'),
      frame.getByText(/[^\s@]+@[^\s@]+/),
      ...(email ? [frame.getByText(email, { exact: false })] : []),
    ]);
  await page.screenshot({ path: path.join(out, `${run}-${step}.png`), fullPage: true, mask });
}

/** Approve an existing sandbox order using the supplied browser page. Never creates or captures an order itself. */
export async function approve(page, url) {
  if (!sandbox(url)) throw new Error('Buyer only accepts HTTPS PayPal sandbox approval URLs.');
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let step = 'opening approval',
    email;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const pay = page
      .locator(
        '#payment-submit-btn, [data-testid="submit-button-initial"], button:has-text("Complete Purchase"), button:has-text("Pay Now"), button:has-text("Agree & Pay"), button:has-text("Continue")',
      )
      .filter({ visible: true })
      .first();
    const emailBox = page.locator('#email');
    const passwordBox = page.locator('#password');
    await visible(page, emailBox.or(passwordBox).or(pay).filter({ visible: true }).first());
    if ((await emailBox.isVisible()) || (await passwordBox.isVisible())) {
      step = 'logging in';
      const login = await credentials();
      email = login.email;
      if (await emailBox.isVisible()) {
        await emailBox.fill(login.email);
        const next = page.locator('#btnNext');
        if (await next.isVisible()) {
          await challenge(page);
          await next.click();
        }
      }
      await visible(page, passwordBox);
      await passwordBox.fill(login.password);
      await challenge(page);
      await page.locator('#btnLogin').click();
    }
    step = 'waiting for approval button';
    await visible(page, pay, 45_000);
    await challenge(page);
    await shot(page, run, '01-after-login', email);
    step = 'approving payment';
    await pay.click();
    const end = Date.now() + 60_000;
    while (Date.now() < end) {
      const current = new URL(page.url());
      if (!sandbox(current.href)) {
        if (current.pathname !== '/return' && !(await page.locator('text=Loading Port Alder').count().catch(() => 0))) {
          await sleep(250);
          continue;
        }
        if (current.searchParams.get('cancel') === '1')
          throw new Error('PayPal returned a canceled approval.');
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await shot(page, run, '02-return', email);
        return { returned: true };
      }
      await challenge(page);
      await sleep(500);
    }
    throw new Error('PayPal did not redirect to /return after approval.');
  } catch (error) {
    if (/^(PayPal |Sandbox buyer |Buyer only|BUYER )/.test(error.message)) throw error;
    // Do not echo Playwright call logs: they may include filled credentials or page content.
    const reason = ({ TimeoutError: 'timeout', Error: 'navigation' })[error.name] || 'selector missing';
    throw new Error(`Buyer failed while ${step} (${reason}). No login-page picture was saved.`);
  }
}

if (isMain(import.meta.url)) {
  let browser;
  try {
    if (process.argv[2] !== 'approve' || !process.argv[3])
      throw new Error('Usage: node tools/buyer.mjs approve <approveUrl>');
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await approve(page, process.argv[3]);
    console.log('Approved: returned to /return.');
  } catch (error) {
    console.error(
      error.message.startsWith('browserType.') ? 'Headless browser could not start.' : error.message,
    );
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}
