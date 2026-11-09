import type { CampaignView, Preorder } from '../../src/shared/types';

export function isUncertainCheckingRefund(p: Preorder, campaign: CampaignView): boolean {
  if (p.state !== 'checking') return false;
  if (p.refundId) return true;
  return (
    (campaign.state === 'closed' || campaign.state === 'closing') &&
    Boolean(campaign.chosen) &&
    campaign.chosen !== p.venue
  );
}

export function isRefundRow(p: Preorder, campaign: CampaignView): boolean {
  return p.state.startsWith('refund') || isUncertainCheckingRefund(p, campaign);
}

export function refundRowsToCheck(campaign: CampaignView): Preorder[] {
  return (campaign.preorders ?? []).filter((p) => {
    if (p.state === 'refund_pending' || p.state === 'refunding') return true;
    if (isUncertainCheckingRefund(p, campaign)) return true;
    return false;
  });
}

export function nextCheckDelay(attempt: number): number {
  if (attempt <= 0) return 5000;
  if (attempt === 1) return 10000;
  if (attempt === 2) return 20000;
  if (attempt === 3) return 40000;
  return 60000;
}
