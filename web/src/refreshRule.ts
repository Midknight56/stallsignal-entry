import type { CampaignView } from '../../src/shared/types';

const pendingStates = ['checking', 'pending', 'capturing', 'refunding', 'refund_pending'];

export function shouldPoll(campaign: CampaignView | null): boolean {
  if (!campaign) return false;
  return (
    campaign.state === 'closing' ||
    (campaign.state === 'open' && campaign.shareToken !== null) ||
    campaign.preorders.some((preorder) => pendingStates.includes(preorder.state))
  );
}
