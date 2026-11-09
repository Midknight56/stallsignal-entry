import { describe, expect, it } from 'vitest';
import { freshCampaign } from '../src/mock/fixtures';
import { shouldPoll } from '../src/refreshRule';

describe('shouldPoll', () => {
  it('polls a shared open campaign without pending preorders', () => {
    expect(shouldPoll({ ...freshCampaign(), shareToken: 'shared-token' })).toBe(true);
  });

  it('does not poll an unshared open campaign without pending preorders', () => {
    expect(shouldPoll(freshCampaign())).toBe(false);
  });

  it('does not poll a closed campaign with a share token', () => {
    expect(shouldPoll({ ...freshCampaign(), state: 'closed', shareToken: 'shared-token' })).toBe(false);
  });

  it('polls when a preorder is refund pending', () => {
    const campaign = freshCampaign();
    const preorder = {
      id: 'pending-refund',
      venue: 'mill' as const,
      product: 'tin' as const,
      qty: 1,
      amountCents: 1,
      state: 'refund_pending' as const,
      orderId: null,
      captureId: null,
      refundId: null,
      debugId: null,
      updatedAt: '2026-11-09T00:00:00Z',
      source: 'live' as const,
    };
    expect(shouldPoll({ ...campaign, preorders: [preorder] })).toBe(true);
  });

  it('polls while the campaign is closing', () => {
    expect(shouldPoll({ ...freshCampaign(), state: 'closing' })).toBe(true);
  });

  it('does not poll a null campaign', () => {
    expect(shouldPoll(null)).toBe(false);
  });
});
