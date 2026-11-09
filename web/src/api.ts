import type {
  AgentView,
  PaymentMethod,
  CampaignView,
  Preorder,
  ProductId,
  ScorecardView,
  SharedCampaignView,
  SharedVenueView,
  VenueId,
} from '../../src/shared/types';
export type { SharedCampaignView, SharedVenueView };
import type { AskView } from '../../src/agent/ask';
import type { DecisionContext } from '../../src/domain/context';
import type { MapWorld } from './world';

export const isMock = (search = typeof location === 'undefined' ? '' : location.search) =>
  new URLSearchParams(search).get('mock') === '1';
async function request<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  if (isMock()) return (await import('./mock')).mockRequest(path, body) as Promise<T>;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('NETWORK');
  }
  if (path === '/webhooks/paypal') {
    if (!response.ok) throw new Error('INVALID_INPUT');
    return undefined as T;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('NETWORK');
  }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'NETWORK');
  return data as T;
}
export const getWorld = () => request<MapWorld>('/api/world');
export const getCampaign = () => request<CampaignView>('/api/campaign');
// The agent reads the same budget, evidence choice and share as the screen.
export const runAgent = (context: DecisionContext) =>
  request<AgentView>('/api/agent', {
    budget: context.budget,
    includeRecorded: context.includeRecorded,
    sharePercent: context.sharePercent,
  });
export const getRecordedAgent = () => request<AgentView>('/api/agent/recorded');
export const createPreorder = (venue: VenueId, product: ProductId, qty: number, method?: PaymentMethod) =>
  request<{ preorder: Preorder; approveUrl: string | null }>('/api/preorders', {
    venue,
    product,
    qty,
    ...(method ? { method } : {}),
  });
export const returnPreorder = (id: string, cancel = false) =>
  request<{ preorder: Preorder }>(`/api/preorders/${encodeURIComponent(id)}/return`, { cancel });
export const reconcilePreorder = (id: string) =>
  request<{ preorder: Preorder }>(`/api/preorders/${encodeURIComponent(id)}/reconcile`, {}, 'POST');
// Close saves the context the maker decided at, so the scorecard shows the same pick later.
export const closeCampaign = (venue: VenueId, context?: DecisionContext) =>
  request<CampaignView>('/api/campaign/close', { venue, ...(context ? { context } : {}) });
export const retryRefund = (id: string) =>
  request<CampaignView>(`/api/campaign/refunds/${encodeURIComponent(id)}/retry`, {}, 'POST');
export const resetCampaign = () => request<CampaignView>('/api/campaign/reset', {}, 'POST');
export const getScorecard = () => request<ScorecardView>('/api/scorecard');
export const shareCampaign = () =>
  request<{ shareToken: string }>('/api/campaign/share', {}, 'POST');
export const revokeShare = () =>
  request<{ ok: true }>('/api/campaign/share/revoke', {}, 'POST');
export const getShared = (token: string) =>
  request<SharedCampaignView>(`/api/shared/${encodeURIComponent(token)}`);
export const createSharedPreorder = (
  token: string,
  venue: VenueId,
  product: ProductId,
  qty: number,
  method?: PaymentMethod,
) =>
  request<{ preorder: Preorder; approveUrl: string | null }>(
    `/api/shared/${encodeURIComponent(token)}/preorders`,
    {
      venue,
      product,
      qty,
      ...(method ? { method } : {}),
    },
  );
export const ask = (q: string) => request<AskView>('/api/ask', { q });
export const health = () => request<{ ok: true }>('/health');
// Webhook sender is server owned. Exposed for contract completeness, never called by the UI.
export const paypalWebhook = (event: unknown) => request<unknown>('/webhooks/paypal', event);

export function approvalHref(approveUrl: string | null): string {
  if (!approveUrl) throw new Error('NETWORK');
  const url = new URL(approveUrl, location.origin);
  if (
    !isMock() &&
    (url.protocol !== 'https:' ||
      !(url.hostname === 'sandbox.paypal.com' || url.hostname.endsWith('.sandbox.paypal.com')))
  )
    throw new Error('INVALID_INPUT');
  return url.href;
}
