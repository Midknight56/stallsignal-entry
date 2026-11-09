import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { world } from './helpers/world';
import { SANDBOX } from '../src/paypal/client';
import { HISTORY_SHARE_PERCENT } from '../src/domain/context';

describe('the agent route and the scorecard use the decision context', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
    w.env.PAYPAL_BASE = SANDBOX;
  });
  afterEach(() => w.db.close());
  const agent = async (body: object) =>
    w.worker.fetch(
      new Request('https://stallsignal.test/api/agent', { method: 'POST', body: JSON.stringify(body) }),
      { ASSETS: w.env.ASSETS } as never,
    );
  it.each([
    [90000, false, 'wharf'],
    [15000, false, 'linden'],
    [90000, true, 'mill'],
  ])('without storage, budget %i, recorded %s picks %s', async (budget, includeRecorded, pick) => {
    const res = await agent({ budget, includeRecorded, sharePercent: HISTORY_SHARE_PERCENT });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pick: string }).pick).toBe(pick);
  });
  it('with storage and no model, this campaign only at $900 picks Shed 9', async () => {
    const v = w.visitor();
    const res = await v.api('/api/agent', {
      budget: 90000,
      includeRecorded: false,
      sharePercent: HISTORY_SHARE_PERCENT,
    });
    expect(((await res.json()) as { pick: string }).pick).toBe('wharf');
  });
  it('refuses a share or evidence choice the screen does not offer', async () => {
    expect((await agent({ budget: 90000, sharePercent: 15 })).status).toBe(400);
    expect((await agent({ budget: 90000, includeRecorded: 'yes' })).status).toBe(400);
  });
  it('close saves the context; the scorecard shows the pick at that context', async () => {
    const v = w.visitor();
    const c = await v.campaign();
    await v.paid('wharf');
    const context = { budget: 15000, includeRecorded: false, sharePercent: HISTORY_SHARE_PERCENT };
    const closed = await v.api('/api/campaign/close', { venue: 'linden', context });
    expect(closed.status).toBe(200);
    const res = await w.worker.fetch(new Request('https://stallsignal.test/api/scorecard'), w.env);
    const row = ((await res.json()) as { campaigns: Array<Record<string, unknown>> }).campaigns.find(
      (r) => r.id === c.id,
    )!;
    expect(row).toMatchObject({ paidPick: 'linden', contextSaved: true, context, decided: 'linden' });
  });
  it('close without a context saves the default', async () => {
    const v = w.visitor();
    const c = await v.campaign();
    await v.api('/api/campaign/close', { venue: 'mill' });
    const res = await w.worker.fetch(new Request('https://stallsignal.test/api/scorecard'), w.env);
    const row = ((await res.json()) as { campaigns: Array<Record<string, unknown>> }).campaigns.find(
      (r) => r.id === c.id,
    )!;
    expect(row).toMatchObject({
      contextSaved: true,
      context: { budget: 90000, includeRecorded: true, sharePercent: HISTORY_SHARE_PERCENT },
    });
  });
  it('close refuses a context the screen does not offer, and the campaign stays open', async () => {
    const v = w.visitor();
    const res = await v.api('/api/campaign/close', { venue: 'mill', context: { budget: 12345 } });
    expect(res.status).toBe(400);
    expect((await v.campaign()).state).toBe('open');
  });
});
