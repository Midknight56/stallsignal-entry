import { describe, expect, it } from 'vitest';
import type { CampaignView, Preorder } from '../../src/shared/types';
import { nextCheckDelay, refundRowsToCheck } from '../src/refundChecks';

describe('refund checks scheduling and row selection', () => {
  it('nextCheckDelay returns backoff sequence for attempts 0 through 6', () => {
    expect(nextCheckDelay(0)).toBe(5000);
    expect(nextCheckDelay(1)).toBe(10000);
    expect(nextCheckDelay(2)).toBe(20000);
    expect(nextCheckDelay(3)).toBe(40000);
    expect(nextCheckDelay(4)).toBe(60000);
    expect(nextCheckDelay(5)).toBe(60000);
    expect(nextCheckDelay(6)).toBe(60000);
  });

  it('refundRowsToCheck picks refund_pending, refunding, uncertain checking and skips non-targets', () => {
    const preorder = (
      id: string,
      state: Preorder['state'],
      venue: Preorder['venue'] = 'wharf',
      refundId: string | null = null,
    ): Preorder => ({
      id,
      campaignId: 'c1',
      venue,
      product: 'tin',
      qty: 1,
      amountCents: 1400,
      method: 'paypal',
      state,
      orderId: 'ord-1',
      captureId: 'cap-1',
      refundId,
      debugId: null,
      approveUrl: null,
      source: 'live',
      createdAt: '2026-11-06T12:00:00Z',
      updatedAt: '2026-11-06T12:00:00Z',
    });

    const campaign: CampaignView = {
      id: 'c1',
      state: 'closed',
      chosen: 'mill',
      decided: 'mill',
      forecastPick: 'mill',
      agreement: true,
      marginCents: 0,
      venues: [],
      liabilityCents: 2800,
      checking: false,
      ops: [],
      preorders: [
        preorder('p-pending', 'refund_pending', 'wharf', 'ref-1'),
        preorder('p-refunding', 'refunding', 'wharf', 'ref-2'),
        preorder('p-checking-with-id', 'checking', 'wharf', 'ref-3'),
        preorder('p-checking-losing', 'checking', 'wharf', null),
        preorder('p-refunded', 'refunded', 'wharf', 'ref-4'),
        preorder('p-captured-chosen', 'captured', 'mill', null),
        preorder('p-refund-failed', 'refund_failed', 'wharf', 'ref-5'),
      ],
    };

    const picked = refundRowsToCheck(campaign).map((p) => p.id);
    expect(picked).toEqual(['p-pending', 'p-refunding', 'p-checking-with-id', 'p-checking-losing']);
  });
});
