import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerWebhook, events } from '../register_webhook.mjs';
import { receipt, recordedAgent } from '../record_run.mjs';
import { approve, challenge } from '../buyer.mjs';

const env = { PAYPAL_SANDBOX_CLIENT_ID: 'test-client', PAYPAL_SANDBOX_SECRET: 'test-secret' };
function stub(hooks = [], failure) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, ...options });
      if (failure) return new Response('private error details must not be printed', { status: 401 });
      return Response.json(
        url.endsWith('/token')
          ? { access_token: 'private-test-token' }
          : options.method === 'POST'
            ? { id: 'new-hook' }
            : { webhooks: hooks },
      );
    },
  };
}
test('dry lists ids and never registers, including on localhost', async () => {
  const f = stub([{ id: 'other-hook', url: 'https://other.example/webhook' }]);
  assert.deepEqual(await registerWebhook({ dry: true, env, fetcher: f.fetcher }), ['other-hook']);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].method, undefined);
});
test('registers exactly the six required subscriptions at the sandbox endpoint', async () => {
  const f = stub();
  assert.deepEqual(await registerWebhook({ origin: 'https://site.example/path', env, fetcher: f.fetcher }), [
    'new-hook',
  ]);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every((c) => c.url.startsWith('https://api-m.sandbox.paypal.com/')));
  assert.deepEqual(JSON.parse(f.calls[2].body), {
    url: 'https://site.example/webhooks/paypal',
    event_types: events.map((name) => ({ name })),
  });
});
test('reuses a matching webhook without mutating other applications', async () => {
  const f = stub([
    { id: 'other', url: 'https://other.example/webhook' },
    {
      id: 'existing',
      url: 'https://site.example/webhooks/paypal',
      event_types: events.map((name) => ({ name })),
    },
  ]);
  assert.deepEqual(await registerWebhook({ origin: 'https://site.example', env, fetcher: f.fetcher }), [
    'existing',
  ]);
  assert.equal(f.calls.length, 2);
});
test('accepts an existing wildcard subscription', async () => {
  const f = stub([
    { id: 'wildcard', url: 'https://site.example/webhooks/paypal', event_types: [{ name: '*' }] },
  ]);
  assert.deepEqual(await registerWebhook({ origin: 'https://site.example', env, fetcher: f.fetcher }), [
    'wildcard',
  ]);
});
test('incomplete existing subscription fails clearly without creating a duplicate', async () => {
  const f = stub([{ id: 'existing', url: 'https://site.example/webhooks/paypal', event_types: [] }]);
  await assert.rejects(
    registerWebhook({ origin: 'https://site.example', env, fetcher: f.fetcher }),
    /lacks required events/,
  );
  assert.equal(f.calls.length, 2);
});
test('missing keys, non-HTTPS target and HTTP failures expose no credentials', async () => {
  const f = stub();
  await assert.rejects(registerWebhook({ env: {}, fetcher: f.fetcher }), /Set PAYPAL_SANDBOX_CLIENT_ID/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(
    registerWebhook({ origin: 'http://localhost:8799', env, fetcher: f.fetcher }),
    /public HTTPS/,
  );
  const fail = stub([], true);
  await assert.rejects(
    registerWebhook({ env, fetcher: fail.fetcher }),
    (error) => error.message === 'PayPal /v1/oauth2/token: HTTP 401',
  );
});
test('receipt allowlist strips payer information, raw responses and unknown fields', () => {
  const sanitized = receipt({
    id: 'preorder',
    state: 'captured',
    orderId: 'ORDER',
    captureId: 'CAPTURE',
    payer: { name: 'private' },
    email: 'private@example.invalid',
    address: 'private',
    body: 'private',
    debugId: 'DEBUG',
  });
  assert.equal(sanitized.captureId, 'CAPTURE');
  assert.equal(sanitized.debugId, 'DEBUG');
  assert.ok(!JSON.stringify(sanitized).includes('private'));
  assert.ok(!('payer' in sanitized));
});
test('recorded answer keeps the real source and capture time with an explicit allowlist', () => {
  const sanitized = recordedAgent(
    {
      source: 'ai',
      facts: [{ id: 'F1', text: 'evidence', payer: 'private' }],
      allocation: [],
      offer: { venue: 'mill', lines: [], terms: '' },
      neurons: { reserved: 15, used: 1, appLeft: 899 },
      email: 'private',
    },
    '2026-11-06T00:00:00Z',
  );
  assert.equal(sanitized.source, 'ai');
  assert.equal(sanitized.capturedAt, '2026-11-06T00:00:00Z');
  assert.ok(!JSON.stringify(sanitized).includes('private'));
});
test('buyer rejects live PayPal and unrelated approval URLs before opening them', async () => {
  for (const url of [
    'https://www.paypal.com/checkoutnow',
    'https://sandbox.paypal.com.evil.invalid/',
    'http://www.sandbox.paypal.com/',
  ])
    await assert.rejects(approve({}, url), /only accepts HTTPS PayPal sandbox/);
});
test('buyer stops at a security challenge without taking a picture or reading credentials', async () => {
  let screenshots = 0;
  const locator = {
    first() {
      return this;
    },
    filter() {
      return this;
    },
    or() {
      return this;
    },
    innerText: async () => 'Security challenge: verify you are human',
    count: async () => 0,
    evaluateAll: async () => false,
  };
  const frame = {
    url: () => 'https://www.sandbox.paypal.com/checkoutnow',
    locator: (selector) => (selector === 'body' ? locator : { ...locator, innerText: async () => '' }),
  };
  const page = {
    goto: async () => {},
    locator: () => locator,
    frames: () => [frame],
    screenshot: async () => {
      screenshots++;
    },
  };
  await assert.rejects(
    approve(page, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER'),
    /security challenge/,
  );
  assert.equal(screenshots, 0);
});
test('buyer ignores an invisible recaptcha anchor frame', async () => {
  const body = { innerText: async () => '' };
  const anchor = {
    count: async () => 1,
    nth() {
      return this;
    },
    getAttribute: async () => 'https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1',
    isVisible: async () => false,
    boundingBox: async () => null,
  };
  const frame = {
    url: () => 'https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1',
    locator: (selector) => (selector === 'iframe[src*="recaptcha"]' ? anchor : body),
  };
  await assert.doesNotReject(challenge({ frames: () => [frame] }));
});
test('buyer skips a detached frame during the challenge scan', async () => {
  const detached = {
    url: () => 'https://www.sandbox.paypal.com/checkoutnow',
    locator: () => ({
      innerText: async () => '',
      count: async () => { throw Object.assign(new Error('private context detail'), { name: 'FrameDetachedError' }); },
    }),
  };
  const healthy = {
    url: () => 'https://www.sandbox.paypal.com/checkoutnow',
    locator: (selector) => selector === 'body'
      ? { innerText: async () => '' }
      : { count: async () => 0 },
  };
  await assert.doesNotReject(challenge({ frames: () => [detached, healthy] }));
});
test('buyer stops for a visible recaptcha bframe', async () => {
  const body = { innerText: async () => '' };
  const bframe = {
    count: async () => 1,
    nth() {
      return this;
    },
    getAttribute: async () => 'https://www.recaptcha.net/recaptcha/enterprise/bframe?ar=1',
    isVisible: async () => true,
    boundingBox: async () => ({ width: 30, height: 30 }),
  };
  const frame = {
    url: () => 'https://www.paypalobjects.com/webcaptcha/grcenterprise_v3_static.html',
    locator: (selector) => (selector === 'iframe[src*="recaptcha"]' ? bframe : body),
  };
  await assert.rejects(challenge({ frames: () => [frame] }), /security challenge/);
});
