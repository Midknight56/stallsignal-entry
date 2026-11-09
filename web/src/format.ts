import type { AgentView, CampaignView, Venue, Preorder, PreorderState, PaymentMethod } from '../../src/shared/types';

export const methodLabel = (method?: PaymentMethod) => (method === 'card' ? 'Card' : 'PayPal');

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const time = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not yet';
export const shortId = (value: string | null) =>
  value ? (value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value) : 'Not yet';
export const shortCampaignId = (value: string | null) =>
  value ? (value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value) : '';
export type ReceiptCampaign = Partial<Pick<CampaignView, 'state' | 'chosen'>>;
export function receiptId(
  p: Preorder,
  kind: 'orderId' | 'captureId' | 'refundId',
  campaign?: ReceiptCampaign,
) {
  if (p[kind]) return p[kind];
  if (['declined', 'canceled', 'failed'].includes(p.state)) return 'None';
  if (
    kind === 'refundId' &&
    p.state === 'captured' &&
    campaign?.state === 'closed' &&
    campaign.chosen === p.venue
  )
    return 'Not needed, venue chosen';
  if (kind === 'orderId' && !['draft', 'creating', 'checking'].includes(p.state)) return 'None';
  if (kind === 'captureId' && (p.state === 'captured' || p.state.startsWith('refund'))) return 'None';
  if (kind === 'refundId' && p.state === 'refunded') return 'None';
  return 'Not yet';
}
export const venueName = (venues: Venue[], id: string) => venues.find((v) => v.id === id)?.name ?? id;
export function decisionLine(campaign: CampaignView, venues: Venue[], includeRecorded = true) {
  const forecast = campaign.forecastPick === 'wharf' ? 'Shed 9' : venueName(venues, campaign.forecastPick);
  const decided = campaign.decided === 'wharf' ? 'Shed 9' : venueName(venues, campaign.decided);
  if (!campaign.venues.some((v) => v.paidUnits + (includeRecorded ? v.recordedUnits : 0) > 0))
    return `Forecast picks ${forecast}. No paid preorders yet.`;
  if (campaign.forecastPick === campaign.decided) return `Forecast and preorders agree: ${decided}.`;
  return `Forecast picks ${forecast}. Preorders pick ${decided}.`;
}
export const stateLabel = (state: PreorderState | string) =>
  ({
    captured: 'Paid',
    checking: 'Checking payment',
    refund_queued: 'Refund queued',
    refunding: 'Refunding',
    refund_pending: 'Refund pending',
    refund_failed: 'Refund failed',
  })[state] ?? state.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
export const stateTone = (state: string) =>
  state === 'captured'
    ? 'paid'
    : state === 'failed' || state === 'declined' || state === 'refund_failed'
      ? 'failed'
      : state.startsWith('refund')
        ? 'refund'
        : state === 'canceled'
          ? 'muted'
          : 'pending';
export const sourceLabel = (
  source: string,
  capturedAt?: string,
  fallback?: AgentView['fallback'] | string,
) => {
  if (source === 'code') {
    if (fallback === 'model_off') return 'Code pick. The model is off right now.';
    if (fallback === 'run_limit') return "Code pick. You have used today's agent runs.";
    if (fallback === 'daily_budget') return "Code pick. Today's free model budget is used up.";
    if (fallback === 'check_failed') return "Code pick. The model's answer failed a check.";
    if (fallback === 'error') return 'Code pick. The model could not be reached.';
    return 'Code pick (model answer failed a check)';
  }
  return (
    ({
      ai: 'Live AI',
      recorded: 'Recorded run',
      cache: `Saved from a live answer${capturedAt && Number.isFinite(Date.parse(capturedAt)) ? `, ${time(capturedAt)}` : ''}`,
      matched: 'Matched without AI',
    } as Record<string, string>)[source] ?? 'Recorded run'
  );
};
export function errorText(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return (
    (
      {
        NOT_YOUR_CAMPAIGN: 'This payment belongs to another session.',
        ALREADY_CLOSING: 'This campaign is already closing. Refresh its status.',
        CHECKING_PAYMENT: 'Check the payment before you continue.',
        CAMPAIGN_CLOSED: 'This campaign is closed. Start a new campaign.',
        RATE_LIMITED: 'Today’s limit has been reached. Please try tomorrow.',
        INVALID_INPUT: 'Please check your choices and try again.',
        NOT_FOUND: 'This payment could not be found.',
        NETWORK: 'We could not reach the service. Please try again.',
      } as Record<string, string>
    )[code] ?? 'We could not finish that request. Please try again.'
  );
}
