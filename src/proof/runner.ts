import { venues } from '../data/venues';
import { Store } from '../engine/store';
import { PayPal } from '../paypal/client';
import { Preorders } from '../engine/preorders';
import { Campaigns } from '../engine/campaign';
import { Webhooks } from '../engine/webhooks';
import { currentCampaign } from '../session';
import type { Preorder, VenueId } from '../shared/types';
import { createProofDatabase, type SqlJsDatabaseAdapter } from './database';
import { FakePayPal } from './fakePayPal';

export interface ProofResult {
  id: string;
  title: string;
  status: 'Held' | 'Failed';
  summary: string;
  requestId?: string;
  orderId?: string;
  refundId?: string;
  captureId?: string;
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function createProofWorld() {
  const db: SqlJsDatabaseAdapter = await createProofDatabase();
  let now = Date.parse('2026-11-06T12:00:00Z');
  const clock = () => now;
  const store = new Store(db, clock);
  const ppFake = new FakePayPal(store);
  const pp = new PayPal(
    {
      PAYPAL_CLIENT_ID: 'proof-client-id',
      PAYPAL_SECRET: 'test-secret',
      PAYPAL_WEBHOOK_ID: 'test-webhook',
    },
    ppFake.fetch,
    clock,
  );
  const preorders = new Preorders(store, pp);
  const campaigns = new Campaigns(store, preorders);
  const webhooks = new Webhooks(store, pp, preorders);
  campaigns.replayEvents = (id) => webhooks.replay(id);

  const sessionId = 'proof-session-1';
  await store.run('INSERT INTO sessions(id,createdAt) VALUES(?,?)', sessionId, store.now());
  const campaign = await currentCampaign(store, sessionId);

  return {
    db,
    store,
    pp: ppFake,
    paypalClient: pp,
    preorders,
    campaigns,
    webhooks,
    campaign,
    sessionId,
    async createPreorder(venue: VenueId = 'wharf', qty = 1, extra = {}): Promise<Preorder> {
      const res = await preorders.create(
        campaign,
        { venue, product: 'tin', qty, ...extra },
        'https://stallsignal.test',
      );
      return res.preorder;
    },
    async paid(venue: VenueId = 'wharf', qty = 1): Promise<Preorder> {
      const p = await this.createPreorder(venue, qty);
      ppFake.approve(p.orderId!);
      await webhooks.replay(campaign.id);
      return await preorders.returned(p.id, false);
    },
    async closeCampaign(venue: VenueId) {
      return await campaigns.close(campaign.id, venue);
    },
    async sendWebhook(event: object, valid = true) {
      ppFake.signature = valid;
      const headers = new Headers({
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/cert/test',
        'paypal-transmission-id': 'transmission-test',
        'paypal-transmission-sig': 'test-signature',
        'paypal-transmission-time': new Date(now).toISOString(),
      });
      return await webhooks.receive(headers, JSON.stringify(event));
    },
  };
}

export async function runLostCaptureScenario(): Promise<ProofResult> {
  const title = 'A lost capture answer is read back from PayPal and settles to one capture, never two.';
  try {
    const w = await createProofWorld();
    try {
      const p = await w.createPreorder();
      w.pp.approve(p.orderId!);
      w.pp.lose = 'capture';
      await w.webhooks.replay(w.campaign.id);
      const returnedPreorder = await w.preorders.returned(p.id, false);
      if (returnedPreorder.state !== 'checking') {
        throw new Error(`Expected checking state after lost capture, got ${returnedPreorder.state}`);
      }
      await w.webhooks.replay(w.campaign.id);
      const reconciledPreorder = await w.preorders.reconcile(p.id);
      if (reconciledPreorder.state !== 'captured') {
        throw new Error(`Expected captured state after reconcile, got ${reconciledPreorder.state}`);
      }
      const captureCount = w.pp.count('capture');
      if (captureCount !== 1) {
        throw new Error(`Expected exactly 1 capture call, got ${captureCount}`);
      }
      const op = await w.store.op('capture', p.id);
      const requestId = op?.requestId ?? `ss-capture-${p.id}`;
      const orderId = reconciledPreorder.orderId ?? p.orderId ?? '';
      const captureId = reconciledPreorder.captureId ?? '';
      const summary =
        'The answer to the capture was lost. The app read the order back from PayPal and recorded one capture.';
      return {
        id: 'lost-capture',
        title,
        status: 'Held',
        summary,
        requestId,
        orderId,
        captureId,
      };
    } finally {
      w.db.close();
    }
  } catch (err) {
    return {
      id: 'lost-capture',
      title,
      status: 'Failed',
      summary: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runConcurrentCloseScenario(): Promise<ProofResult> {
  const title = 'Two closes at the same moment run once.';
  try {
    const w = await createProofWorld();
    try {
      const paid = await w.paid();
      const replies = await Promise.allSettled([w.closeCampaign('mill'), w.closeCampaign('linden')]);
      const fulfilled = replies.filter((r) => r.status === 'fulfilled');
      const rejected = replies.filter((r) => r.status === 'rejected');
      if (fulfilled.length !== 1 || rejected.length !== 1) {
        throw new Error(
          `Expected 1 success and 1 rejection, got ${fulfilled.length} fulfilled and ${rejected.length} rejected`,
        );
      }
      const refundCount = w.pp.count('refund');
      if (refundCount !== 1) {
        throw new Error(`Expected exactly 1 refund call, got ${refundCount}`);
      }
      const preorder = await w.store.preorder(paid.id);
      const op = await w.store.op('refund', paid.id);
      const requestId = op?.requestId ?? `ss-refund-${paid.id}`;
      const orderId = preorder?.orderId ?? paid.orderId ?? '';
      const refundId = preorder?.refundId ?? '';
      const summary =
        'Two closes arrived together. The app closed the campaign once and refunded one payment.';
      return {
        id: 'concurrent-close',
        title,
        status: 'Held',
        summary,
        requestId,
        orderId,
        refundId,
      };
    } finally {
      w.db.close();
    }
  } catch (err) {
    return {
      id: 'concurrent-close',
      title,
      status: 'Failed',
      summary: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runLateCaptureCloseScenario(): Promise<ProofResult> {
  const title = 'A capture that lands while the campaign closes is refunded if its venue lost.';
  try {
    const w = await createProofWorld();
    try {
      const p = await w.createPreorder();
      w.pp.approve(p.orderId!);
      const entered = deferred();
      const release = deferred();
      w.pp.captureGate = async () => {
        entered.resolve();
        await release.promise;
      };
      await w.webhooks.replay(w.campaign.id);
      const capturePromise = w.preorders.returned(p.id, false);
      await entered.promise;
      await w.closeCampaign('mill');
      release.resolve();
      const captureRes = await capturePromise;
      if (captureRes.state !== 'refunded') {
        throw new Error(`Expected preorder state refunded, got ${captureRes.state}`);
      }
      const preorder = await w.store.preorder(p.id);
      const op = await w.store.op('refund', p.id);
      const requestId = op?.requestId ?? `ss-refund-${p.id}`;
      const orderId = preorder?.orderId ?? p.orderId ?? '';
      const refundId = preorder?.refundId ?? '';
      const summary = `The capture for ${venues.find((venue) => venue.id === p.venue)!.name} arrived after closing. The app refunded it because that venue lost.`;
      return {
        id: 'late-capture-close',
        title,
        status: 'Held',
        summary,
        requestId,
        orderId,
        refundId,
      };
    } finally {
      w.db.close();
    }
  } catch (err) {
    return {
      id: 'late-capture-close',
      title,
      status: 'Failed',
      summary: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runClientAmountIgnoredScenario(): Promise<ProofResult> {
  const title = 'A client that sends its own amount is ignored; the catalog price is used.';
  try {
    const w = await createProofWorld();
    try {
      const p = await w.createPreorder('wharf', 2, { amount: 1, price: 1, amountCents: 1, product: 'jar' });
      if (p.amountCents !== 5600) {
        throw new Error(`Expected catalog amount 5600 cents, got ${p.amountCents}`);
      }
      const order = w.pp.orders.get(p.orderId!);
      const unit = (order?.createBody.purchase_units as { amount: { value: string } }[])?.[0];
      if (unit?.amount?.value !== '56.00') {
        throw new Error(`Expected purchase unit value 56.00, got ${unit?.amount?.value}`);
      }
      const op = await w.store.op('create', p.id);
      const requestId = op?.requestId ?? `ss-create-${p.id}`;
      const orderId = p.orderId ?? '';
      const summary = `The app ignored the amount sent by the browser and used the catalog price of $${(p.amountCents / 100).toFixed(2)}.`;
      return {
        id: 'client-amount-ignored',
        title,
        status: 'Held',
        summary,
        requestId,
        orderId,
      };
    } finally {
      w.db.close();
    }
  } catch (err) {
    return {
      id: 'client-amount-ignored',
      title,
      status: 'Failed',
      summary: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runDuplicateWebhookScenario(): Promise<ProofResult> {
  const title = 'A repeated webhook event changes nothing the second time.';
  try {
    const w = await createProofWorld();
    try {
      const p = await w.paid();
      const event = {
        id: 'webhook-repeat-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: p.captureId, custom_id: `ss-${w.campaign.id}-${p.id}` },
      };
      await w.sendWebhook(event);
      const readsBefore = w.pp.requests.filter((r) => r.path.includes(`/captures/${p.captureId}`)).length;
      await w.sendWebhook(event);
      const readsAfter = w.pp.requests.filter((r) => r.path.includes(`/captures/${p.captureId}`)).length;
      if (readsBefore !== readsAfter) {
        throw new Error(
          `Expected duplicate webhook to skip PayPal reads, but reads changed from ${readsBefore} to ${readsAfter}`,
        );
      }
      const op = await w.store.op('capture', p.id);
      const requestId = op?.requestId ?? `ss-capture-${p.id}`;
      const orderId = p.orderId ?? '';
      const summary = 'The same payment notice arrived twice. The app ignored the second copy.';
      return {
        id: 'duplicate-webhook',
        title,
        status: 'Held',
        summary,
        requestId,
        orderId,
        captureId: p.captureId ?? undefined,
      };
    } finally {
      w.db.close();
    }
  } catch (err) {
    return {
      id: 'duplicate-webhook',
      title,
      status: 'Failed',
      summary: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runLateWebhookScenario(): Promise<ProofResult> {
  const title = 'A late webhook never moves a refunded payment back to captured.';
  try {
    const w = await createProofWorld();
    try {
      const p = await w.paid();
      await w.closeCampaign('mill');
      const beforePreorder = await w.store.preorder(p.id);
      if (beforePreorder?.state !== 'refunded') {
        throw new Error(`Expected preorder state refunded after close, got ${beforePreorder?.state}`);
      }
      const lateEvent = {
        id: 'webhook-late-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: p.captureId, custom_id: `ss-${w.campaign.id}-${p.id}` },
      };
      await w.sendWebhook(lateEvent);
      const afterPreorder = await w.store.preorder(p.id);
      if (afterPreorder?.state !== 'refunded') {
        throw new Error(`Expected preorder state to stay refunded, got ${afterPreorder?.state}`);
      }
      const op = await w.store.op('refund', p.id);
      const requestId = op?.requestId ?? `ss-refund-${p.id}`;
      const orderId = p.orderId ?? '';
      const refundId = afterPreorder.refundId ?? '';
      const summary = 'A late capture notice arrived after the refund. The payment stayed refunded.';
      return {
        id: 'late-webhook-refunded',
        title,
        status: 'Held',
        summary,
        requestId,
        orderId,
        refundId,
      };
    } finally {
      w.db.close();
    }
  } catch (err) {
    return {
      id: 'late-webhook-refunded',
      title,
      status: 'Failed',
      summary: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runAllProofs(): Promise<ProofResult[]> {
  return [
    await runLostCaptureScenario(),
    await runConcurrentCloseScenario(),
    await runLateCaptureCloseScenario(),
    await runClientAmountIgnoredScenario(),
    await runDuplicateWebhookScenario(),
    await runLateWebhookScenario(),
  ];
}
