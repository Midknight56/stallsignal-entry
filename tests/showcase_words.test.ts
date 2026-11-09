import { describe, expect, it } from 'vitest';
import { makeFacts } from '../src/agent/facts';
import type { Preorder } from '../src/shared/types';

describe('agent facts showcase words', () => {
  it('facts built for a campaign with live and recorded paid units contain no sandbox', () => {
    const livePreorder: Preorder = {
      id: 'live-1',
      venue: 'mill',
      qty: 3,
      product: 'tin',
      amountCents: 4200,
      state: 'captured',
      source: 'live',
      captureId: 'cap-1',
      orderId: null,
      refundId: null,
      debugId: null,
      updatedAt: '',
    };
    const recordedPreorder: Preorder = {
      id: 'rec-1',
      venue: 'mill',
      qty: 2,
      product: 'tin',
      amountCents: 2800,
      state: 'captured',
      source: 'recorded',
      captureId: 'cap-2',
      orderId: null,
      refundId: null,
      debugId: null,
      updatedAt: '',
    };
    const facts = makeFacts({
      budget: 90000,
      preorders: [livePreorder],
      recorded: [recordedPreorder],
    });
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.text.toLowerCase()).not.toContain('sandbox');
    }
  });
});
