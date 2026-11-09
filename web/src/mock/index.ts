import { keywordMatch } from '../../../src/agent/ask';
import { closedCampaign } from '../../../src/domain/scorecard';
import { decide, evidenceCounts } from '../../../src/domain/blend';
import { forecastUnits } from '../../../src/domain/forecast';
import type { CampaignView, PaymentMethod, ProductId, VenueId } from '../../../src/shared/types';
import { freshCampaign, mockAgent, mockRecordedAgent, scorecard, world } from './fixtures';

let campaign: CampaignView | undefined;
const read = () => {
  if (!campaign) {
    try {
      campaign = JSON.parse(sessionStorage.getItem('ss-mock-v2') ?? 'null') ?? freshCampaign();
    } catch {
      campaign = freshCampaign();
    }
  }
  return campaign!;
};
const save = () => {
  try {
    sessionStorage.setItem('ss-mock-v2', JSON.stringify(campaign));
  } catch {
    /* Memory still works. */
  }
};
function totals() {
  const c = read();
  c.checking = c.preorders.some((p) => p.state === 'checking');
  Object.assign(c, decide(c.preorders, 90000, world.recorded?.preorders ?? []));
  Object.assign(c, evidenceCounts(c.preorders, world.recorded?.preorders ?? []));
  c.liabilityCents = c.preorders
    .filter((p) => ['refund_queued', 'refunding', 'refund_pending', 'refund_failed'].includes(p.state))
    .reduce((s, p) => s + p.amountCents, 0);
  save();
}
export async function mockRequest(path: string, body?: unknown): Promise<unknown> {
  const c = read();
  const b = (body ?? {}) as {
    venue: VenueId;
    product: ProductId;
    qty: number;
    method?: PaymentMethod;
    budget: number;
    includeRecorded?: boolean;
    sharePercent?: number;
    context?: unknown;
    cancel?: boolean;
    q?: string;
  };
  const id = decodeURIComponent(path.split('/')[3] ?? '');
  if (path === '/api/world') return structuredClone(world);
  if (path === '/health') return { ok: true };
  if (path === '/webhooks/paypal') throw new Error('INVALID_INPUT');
  if (path === '/api/agent') return mockAgent(b.budget, c, b.includeRecorded !== false, b.sharePercent);
  if (path === '/api/agent/recorded') return mockRecordedAgent();
  if (path === '/api/ask') return keywordMatch(b.q ?? '');
  if (path === '/api/scorecard') {
    const s = scorecard();
    if (c.state === 'closed')
      s.campaigns.push(
        closedCampaign(
          c.id,
          c.preorders,
          c.chosen!,
          new Date().toISOString(),
          world.recorded?.preorders ?? [],
        ),
      );
    return s;
  }
  if (path === '/api/preorders') {
    if (c.state !== 'open') throw new Error('CAMPAIGN_CLOSED');
    if (c.checking) throw new Error('CHECKING_PAYMENT');
    const p = {
      id: `mock-${crypto.randomUUID()}`,
      venue: b.venue,
      product: b.product,
      qty: b.qty,
      method: b.method ?? 'paypal',
      amountCents: world.catalog.find((p) => p.id === b.product)!.priceCents * b.qty,
      state: b.method === 'card' ? ('captured' as const) : ('created' as const),
      orderId: `MOCK-ORDER-${crypto.randomUUID()}`,
      captureId: b.method === 'card' ? `MOCK-CAPTURE-${crypto.randomUUID()}` : null,
      refundId: null,
      debugId: null,
      updatedAt: new Date().toISOString(),
      source: 'live' as const,
    };
    c.preorders.push(p);
    c.ops.push({
      kind: 'create',
      requestId: `mock-create-${p.id}`,
      status: 'ok',
      http: 201,
      paypalId: p.orderId,
      at: p.updatedAt,
    });
    totals();
    return {
      preorder: structuredClone(p),
      approveUrl: b.method === 'card' ? null : `/return?mock=1&p=${p.id}`,
    };
  }
  if (path.startsWith('/api/preorders/')) {
    const p = c.preorders.find((p) => p.id === id);
    if (!p) throw new Error('NOT_FOUND');
    if (p.state === 'created' || p.state === 'approved') {
      p.state = b.cancel || c.state !== 'open' ? 'canceled' : 'captured';
      if (p.state === 'captured') {
        p.captureId = `MOCK-CAPTURE-${p.id}`;
        c.ops.push({
          kind: 'capture',
          requestId: `mock-capture-${p.id}`,
          status: 'ok',
          http: 201,
          paypalId: p.captureId,
          at: new Date().toISOString(),
        });
      }
      p.updatedAt = new Date().toISOString();
    }
    totals();
    return { preorder: structuredClone(p) };
  }
  if (path === '/api/campaign/close') {
    if (c.checking) throw new Error('CHECKING_PAYMENT');
    if (c.state !== 'open') throw new Error('ALREADY_CLOSING');
    c.chosen = b.venue;
    c.state = 'closed';
    c.preorders.forEach((p) => {
      if (p.venue !== b.venue) {
        if (p.state === 'captured') {
          p.state = 'refunded';
          p.refundId = `MOCK-REFUND-${p.id}`;
          p.updatedAt = new Date().toISOString();
          c.ops.push({
            kind: 'refund',
            requestId: `mock-refund-${p.id}`,
            status: 'ok',
            http: 201,
            paypalId: p.refundId,
            at: p.updatedAt,
          });
        } else if (['created', 'approved'].includes(p.state)) p.state = 'canceled';
      }
    });
  }
  if (path.includes('/refunds/')) {
    const p = c.preorders.find((p) => p.id === decodeURIComponent(path.split('/')[4]));
    if (p?.state === 'refund_failed') {
      p.state = 'refunded';
      p.refundId = `MOCK-REFUND-${p.id}`;
    }
  }
  if (path === '/api/campaign/reset') {
    if (c.state !== 'closed') throw new Error('INVALID_INPUT');
    campaign = freshCampaign();
    campaign.id = `mock-campaign-${Date.now()}`;
  }
  if (path === '/api/campaign/share') {
    if (c.state !== 'open') throw new Error('CAMPAIGN_CLOSED');
    if (!c.shareToken) c.shareToken = `mock-share-${crypto.randomUUID()}`;
    save();
    return { shareToken: c.shareToken };
  }
  if (path === '/api/campaign/share/revoke') {
    c.shareToken = null;
    save();
    return { ok: true };
  }
  if (path.startsWith('/api/shared/')) {
    const parts = path.split('/');
    const token = decodeURIComponent(parts[3] ?? '');
    const isPreorders = parts[4] === 'preorders';
    if (!c.shareToken || c.shareToken !== token) throw new Error('NOT_FOUND');
    if (isPreorders) {
      if (c.state !== 'open') throw new Error('CAMPAIGN_CLOSED');
      if (c.checking) throw new Error('CHECKING_PAYMENT');
      const p = {
        id: `mock-${crypto.randomUUID()}`,
        venue: b.venue,
        product: b.product,
        qty: b.qty,
        method: b.method ?? 'paypal',
        amountCents: world.catalog.find((prod) => prod.id === b.product)!.priceCents * b.qty,
        state: b.method === 'card' ? ('captured' as const) : ('created' as const),
        orderId: `MOCK-ORDER-${crypto.randomUUID()}`,
        captureId: b.method === 'card' ? `MOCK-CAPTURE-${crypto.randomUUID()}` : null,
        refundId: null,
        debugId: null,
        updatedAt: new Date().toISOString(),
        source: 'live' as const,
        from: 'buyer' as const,
      };
      c.preorders.push(p);
      c.ops.push({
        kind: 'create',
        requestId: `mock-create-${p.id}`,
        status: 'ok',
        http: 201,
        paypalId: p.orderId,
        at: p.updatedAt,
      });
      totals();
      return {
        preorder: structuredClone(p),
        approveUrl: b.method === 'card' ? null : `/return?mock=1&p=${p.id}`,
      };
    }
    const liveCaptured = c.preorders.filter((p) => p.source === 'live' && p.state === 'captured');
    const venues = world.venues.map((v) => ({
      id: v.id,
      forecastUnits: forecastUnits(v),
      paidUnits: liveCaptured.filter((p) => p.venue === v.id).reduce((s, p) => s + p.qty, 0),
    }));
    const mine = c.preorders.filter((p) => p.from === 'buyer');
    return {
      campaignState: c.state,
      chosen: c.chosen,
      venues,
      catalog: world.catalog,
      mine: structuredClone(mine),
    };
  }
  totals();
  return structuredClone(read());
}
