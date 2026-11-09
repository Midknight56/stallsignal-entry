import { base, isMain } from './runtime.mjs';

const endpoint = 'https://api-m.sandbox.paypal.com';
export const events = [
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.PENDING',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
  'CHECKOUT.ORDER.APPROVED',
];

export async function registerWebhook({
  dry = false,
  origin = base,
  env = process.env,
  fetcher = fetch,
} = {}) {
  const id = env.PAYPAL_SANDBOX_CLIENT_ID,
    secret = env.PAYPAL_SANDBOX_SECRET;
  if (!id || !secret) throw new Error('Set PAYPAL_SANDBOX_CLIENT_ID and PAYPAL_SANDBOX_SECRET.');
  async function call(route, options = {}) {
    let res;
    try {
      res = await fetcher(`${endpoint}${route}`, { ...options, signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error(`PayPal ${route}: network request failed.`);
    }
    if (!res.ok) throw new Error(`PayPal ${route}: HTTP ${res.status}`);
    return res.json();
  }
  const token = await call('/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!token.access_token) throw new Error('PayPal did not return an access token.');
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
  const list = await call('/v1/notifications/webhooks', { headers });
  if (dry) return (list.webhooks || []).map((hook) => hook.id);
  const target = new URL('/webhooks/paypal', origin);
  if (target.protocol !== 'https:' || target.username || target.password)
    throw new Error('Webhook SS_BASE must be a public HTTPS origin. Use --dry to list without registration.');
  const existing = (list.webhooks || []).find((hook) => hook.url === target.href);
  if (existing) {
    const names = new Set(existing.event_types.map((event) => event.name));
    if (!names.has('*') && events.some((event) => !names.has(event)))
      throw new Error('Existing webhook lacks required events. Update its subscriptions before using it.');
    return [existing.id];
  }
  const created = await call('/v1/notifications/webhooks', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: target.href, event_types: events.map((name) => ({ name })) }),
  });
  if (!created.id) throw new Error('PayPal did not return a webhook id.');
  return [created.id];
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--dry'))
      throw new Error('Usage: node tools/register_webhook.mjs [--dry]');
    for (const id of await registerWebhook({ dry: process.argv.includes('--dry') })) console.log(id);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
