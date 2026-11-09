export type VenueId = 'wharf' | 'mill' | 'linden';
export type ProductId = 'tin' | 'jar' | 'trio';
export type PaymentMethod = 'card' | 'paypal';
export type PreorderState =
  | 'draft'
  | 'creating'
  | 'created'
  | 'approved'
  | 'capturing'
  | 'checking'
  | 'pending'
  | 'declined'
  | 'failed'
  | 'captured'
  | 'refund_queued'
  | 'refunding'
  | 'refunded'
  | 'refund_pending'
  | 'refund_failed'
  | 'canceled';

export interface Venue {
  id: VenueId;
  name: string;
  district: string;
  rentCents: number;
  stockCap: number;
  x: number;
  y: number;
}

export interface Product {
  id: ProductId;
  name: string;
  priceCents: number;
  unitCostCents: number;
  defaultMix: number;
}

export interface Preorder {
  id: string;
  method?: PaymentMethod; // Older recorded receipts predate this field and mean PayPal.
  venue: VenueId;
  product: ProductId;
  qty: number;
  amountCents: number;
  state: PreorderState;
  orderId: string | null;
  captureId: string | null;
  refundId: string | null;
  debugId: string | null;
  updatedAt: string;
  source: 'live' | 'recorded';
  label?: string;
  from?: 'maker' | 'buyer';
}

export interface Op {
  kind: 'create' | 'capture' | 'refund' | 'read';
  requestId: string;
  status: 'sending' | 'ok' | 'lost' | 'failed';
  http: number | null;
  paypalId: string | null;
  at: string;
}

export interface CampaignVenueView {
  id: VenueId;
  forecastUnits: number;
  recordedUnits: number;
  paidUnits: number;
  pendingUnits: number;
  blendedUnits: number;
  marginCents: number;
}

export interface CampaignView {
  id: string;
  state: 'open' | 'closing' | 'closed';
  chosen: VenueId | null;
  forecastPick: VenueId;
  decided: VenueId;
  overturned: boolean;
  venues: CampaignVenueView[];
  preorders: Preorder[];
  liabilityCents: number;
  checking: boolean;
  ops: Op[];
  shareToken: string | null;
  // Live captured orders, recorded orders that count as evidence, and live captured money not refunded.
  paidOrders: number;
  recordedOrders: number;
  capturedCents: number;
}

export interface SharedVenueView {
  id: VenueId;
  forecastUnits: number;
  paidUnits: number;
}

export interface SharedCampaignView {
  campaignState: 'open' | 'closing' | 'closed';
  chosen: VenueId | null;
  venues: SharedVenueView[];
  catalog: Product[];
  mine: Preorder[];
}

export interface AgentView {
  // Optional for recorded answers and cache entries made before the tool loop.
  steps?: { tool: string; venue?: VenueId; label: string }[];
  label?: string;
  capturedAt?: string;
  kind?: string;
  usageUnknown?: boolean;
  pick: VenueId;
  codePick: VenueId;
  source: 'ai' | 'code' | 'recorded' | 'cache';
  fallback?: 'model_off' | 'run_limit' | 'daily_budget' | 'check_failed' | 'error';
  budgetCents?: number;
  facts: { id: string; text: string }[];
  risk: 'low' | 'medium' | 'high';
  allocation: { product: ProductId; units: number; costCents: number }[];
  stockCostCents: number;
  offer: { venue: VenueId; lines: string[]; terms: string };
  neurons: { reserved: number; used: number; appLeft: number };
}

export interface HistoryRow {
  id: string;
  venue: VenueId;
  season: 'summer' | 'autumn' | 'winter';
  footfall: number;
  forecastUnits: number;
  actualUnits: number;
  preorderUnits: number;
}

export interface ScorecardHistoryRow extends HistoryRow {
  errorPercent: number; // percentage points, 56.25 = 56.25%
}

export interface ScorecardCampaignRow {
  id: string;
  forecastPick: VenueId;
  decided: VenueId;
  paidUnits: Record<VenueId, number>;
  forecastWrong: boolean;
  paidOrders: number;
  verdict: 'no_evidence' | 'changed' | 'kept';
  outcomeMeasured: false;
  paidPick?: VenueId;
  closedAt?: string | null;
  preorderCount?: number;
  refundCount?: number;
  // The budget, evidence choice and share the pick was worked out at. Saved at close; older rows use the default.
  context?: { budget: number; includeRecorded: boolean; sharePercent: number };
  contextSaved?: boolean;
}

export interface ScorecardPerVenueRow {
  venue: VenueId;
  meanAbsoluteError: number;
}

export interface ScorecardView {
  history: ScorecardHistoryRow[];
  campaigns: ScorecardCampaignRow[];
  perVenue: ScorecardPerVenueRow[];
}

export interface HeatCell {
  x: number;
  y: number;
  jobs: number;
  interest: number;
  label?: string;
  radius?: number;
}

export interface World {
  agent?: { available: boolean };
  city: typeof import('../data/city').city;
  venues: Venue[];
  catalog: Product[];
  heat: HeatCell[];
  history: HistoryRow[];
  recorded: { id: string; preorders: Preorder[]; label: string; recordedAt?: string | null } | null;
  preorderShare: number;
  modes: string[];
}
