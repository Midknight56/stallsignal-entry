import type { AgDataSourcesDefinition, AgFieldDefinition } from 'ag-studio';
import type {
  CampaignView,
  Preorder,
  PreorderState,
  ScorecardView,
  VenueId,
} from '../../../src/shared/types';
import type { MapWorld } from '../world';
import { recordingTime } from '../world';
import { stateLabel } from '../format';

export const outstandingStates: readonly PreorderState[] = [
  'refund_queued',
  'refunding',
  'refund_pending',
  'refund_failed',
];
export const isOutstanding = (state: PreorderState) => outstandingStates.includes(state);

export const refundStates: readonly PreorderState[] = [
  'refund_queued',
  'refunding',
  'refunded',
  'refund_pending',
  'refund_failed',
];
export const isRefund = (state: PreorderState) => refundStates.includes(state);

export const unsettledPaymentStates: readonly PreorderState[] = [
  'draft',
  'creating',
  'created',
  'approved',
  'capturing',
  'checking',
  'pending',
];
export const isUnsettledPayment = (state: PreorderState) => unsettledPaymentStates.includes(state);

export function shapeTables(world: MapWorld, campaign: CampaignView, scorecard: ScorecardView) {
  const name = (id: VenueId) => world.venues.find((v) => v.id === id)?.name ?? id;
  const recordedSource = recordingTime(world)
    ? `Recorded run, ${recordingTime(world)}`
    : 'Recorded run';
  const venues = world.venues.map((v) => {
    const totals = campaign.venues.find((row) => row.id === v.id);
    return {
      ...v,
      venue: v.name,
      venueId: v.id,
      forecast: totals?.forecastUnits ?? 0,
      paid: totals?.paidUnits ?? 0,
      recorded: totals?.recordedUnits ?? 0,
      paidUnits: (totals?.paidUnits ?? 0) + (totals?.recordedUnits ?? 0),
    };
  });
  const history = scorecard.history.map((row) => ({
    id: row.id,
    venueId: row.venue,
    venue: name(row.venue),
    season: row.season,
    label: `${{ wharf: 'Wharf', mill: 'Millrace', linden: 'Linden' }[row.venue]} ${row.season}`,
    forecast: row.forecastUnits,
    actual: row.actualUnits,
    errorPercent: row.errorPercent,
    direction: row.errorPercent > 0 ? 'Over' : row.errorPercent < 0 ? 'Under' : 'Exact',
    over: row.errorPercent > 0 ? row.errorPercent : null,
    under: row.errorPercent < 0 ? row.errorPercent : null,
    source: 'Forecast history',
  }));
  // Keep the recorded receipt authoritative if a combined response repeats its id.
  const receipts = new Map<string, Preorder>(
    (world.recorded?.preorders ?? []).map((p) => [p.id, { ...p, source: 'recorded' as const }]),
  );
  for (const p of campaign.preorders) if (!receipts.has(p.id)) receipts.set(p.id, p);
  const preorders = [...receipts.values()].map((p) => ({
    ...p,
    venueId: p.venue,
    venue: name(p.venue),
    stateLabel: stateLabel(p.state),
    source: p.source === 'recorded' ? recordedSource : 'Live payment',
    outstanding: isOutstanding(p.state),
    liabilityCents: isOutstanding(p.state) ? p.amountCents : 0,
    amount: p.amountCents / 100,
    orderId: p.orderId ?? null,
    refund: isRefund(p.state),
    unsettled: isUnsettledPayment(p.state),
  }));
  const evidence: {
    id: string;
    venueId: VenueId;
    venue: string;
    kind: 'forecast' | 'history' | 'recorded' | 'live';
    label: string;
    value: string;
    source: string;
  }[] = [];
  for (const v of campaign.venues) {
    evidence.push({
      id: `${v.id}:forecast`,
      venueId: v.id,
      venue: name(v.id),
      kind: 'forecast',
      label: 'Winter forecast',
      value: `${v.forecastUnits} units`,
      source: 'Forecast history',
    });
    evidence.push({
      id: `${v.id}:paid`,
      venueId: v.id,
      venue: name(v.id),
      kind: 'live',
      label: 'Your captured demand',
      value: `${v.paidUnits} units`,
      source: 'Live payment',
    });
  }
  for (const row of history)
    evidence.push({
      id: row.id,
      venueId: row.venueId,
      venue: row.venue,
      kind: 'history',
      label: `${row.season} forecast / actual`,
      value: `${row.forecast} / ${row.actual} units`,
      source: row.source,
    });
  for (const p of preorders)
    evidence.push({
      id: `payment:${p.id}`,
      venueId: p.venueId,
      venue: p.venue,
      kind: p.source === 'Live payment' ? 'live' : 'recorded',
      label: `${p.qty} units · ${p.stateLabel}`,
      value: `${p.amountCents} cents`,
      source: p.source,
    });
  return { venues, history, preorders, evidence };
}
export type StudioTables = ReturnType<typeof shapeTables>;

const text = (id: string, name: string): AgFieldDefinition => ({ id, name, format: 'textFormat' });
const number = (id: string, name: string): AgFieldDefinition => ({ id, name, format: 'integerFormat' });
const percent = (id: string, name: string): AgFieldDefinition => ({
  id,
  name,
  format: 'percentageFormat',
  formatOptions: { format: '0.0%' },
});
const venueFields = [text('venueId', 'Venue ID'), text('venue', 'Venue')];

export function studioData(tables: StudioTables): AgDataSourcesDefinition {
  return {
    sources: [
      {
        id: 'venues',
        name: 'Venues',
        data: tables.venues,
        fields: [
          ...venueFields,
          text('district', 'Street'),
          number('rentCents', 'Weekend rent in cents'),
          number('stockCap', 'Stock cap'),
          number('forecast', 'Forecast'),
          number('paid', 'Live paid'),
          number('recorded', 'Recorded paid'),
          number('paidUnits', 'Paid units'),
        ],
      },
      {
        id: 'evidence',
        name: 'Evidence',
        data: tables.evidence,
        fields: [
          ...venueFields,
          text('id', 'Fact ID'),
          text('kind', 'Kind'),
          text('label', 'Fact'),
          text('value', 'Value'),
          text('source', 'Source'),
        ],
      },
      {
        id: 'history',
        name: 'Forecast history',
        data: tables.history,
        fields: [
          ...venueFields,
          text('id', 'Row'),
          text('label', 'Venue and season'),
          text('season', 'Season'),
          number('forecast', 'Forecast units'),
          number('actual', 'Actual units'),
          percent('errorPercent', 'Forecast error'),
          number('over', 'Over (%)'),
          number('under', 'Under (%)'),
          text('direction', 'Direction'),
          text('source', 'Source'),
        ],
      },
      {
        id: 'preorders',
        name: 'Preorders',
        data: tables.preorders,
        fields: [
          ...venueFields,
          text('id', 'Preorder'),
          text('orderId', 'Order ID'),
          text('state', 'State'),
          text('stateLabel', 'Payment state'),
          number('qty', 'Units'),
          number('amount', 'Amount'),
          number('amountCents', 'Amount in cents'),
          number('liabilityCents', 'Liability in cents'),
          { id: 'outstanding', name: 'Outstanding refund', format: 'booleanFormat' },
          { id: 'refund', name: 'Refund', format: 'booleanFormat' },
          { id: 'unsettled', name: 'Not settled', format: 'booleanFormat' },
          text('source', 'Source'),
        ],
      },
    ],
    relationships: ['evidence', 'history', 'preorders'].map((id) => ({
      id: `${id}_venue`,
      source: { tableId: id, fieldId: 'venueId' },
      target: { tableId: 'venues', fieldId: 'venueId' },
      type: 'many-to-one',
    })),
  };
}
