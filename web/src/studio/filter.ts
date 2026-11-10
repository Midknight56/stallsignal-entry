import type { AgFilterState, AgReportState } from 'ag-studio';
import type { VenueId } from '../../../src/shared/types';
import type { StudioTables } from './data';

export type View = 'overestimated' | 'underestimated' | 'by_venue' | 'refunds_open' | 'paid_vs_forecast';
export type Selection = { venue: VenueId | null; view: View };
export const initialSelection: Selection = { venue: null, view: 'by_venue' };
export const toggleVenue = (current: Selection, venue: VenueId): Selection => ({
  ...current,
  venue: current.venue === venue ? null : venue,
});

export function filterTables(tables: StudioTables, selection: Selection): StudioTables {
  const atVenue = (row: { venueId: VenueId }) => !selection.venue || row.venueId === selection.venue;
  return {
    venues: tables.venues.filter(atVenue),
    evidence: tables.evidence.filter(atVenue),
    history: tables.history
      .filter(atVenue)
      .filter((row) =>
        selection.view === 'overestimated'
          ? row.errorPercent > 0
          : selection.view === 'underestimated'
            ? row.errorPercent < 0
            : true,
      ),
    preorders: tables.preorders
      .filter(atVenue)
      .filter((row) => selection.view !== 'refunds_open' || row.outstanding),
  };
}

// Native grid selections contain field/value pairs; chart selections contain the row label.
export function venueFromCrossFilter(state: AgReportState, tables: StudioTables): VenueId | null | undefined {
  const page = state.pages.find((p) => p.id === state.selectedPageId);
  const groups = Object.values(page?.crossFilter?.values ?? {}).flat();
  if (!groups.length) return undefined;
  for (const group of groups) {
    const pairs =
      group.type === 'value'
        ? group.values.map((value) => ({ field: group.field, value }))
        : group.type === 'multiValue'
          ? group.values.flat()
          : [];
    for (const pair of pairs) {
      const key = pair.field.id;
      if (key.endsWith('.venueId') && tables.venues.some((v) => v.venueId === pair.value))
        return pair.value as VenueId;
      if (key.endsWith('.venue')) {
        const v = tables.venues.find((v) => v.venue === pair.value);
        if (v) return v.venueId;
      }
      if (key === 'history.label') {
        const row = tables.history.find((r) => r.label === pair.value);
        if (row) return row.venueId;
      }
    }
  }
  return null;
}

const BUILT_IN = ['map', 'evidence', 'errors', 'refunds'];
function addedFilters(widget: Record<string, AgFilterState[]> | undefined) {
  return Object.fromEntries(Object.entries(widget ?? {}).filter(([id]) => !BUILT_IN.includes(id)));
}

export function applySelection(state: AgReportState, selection: Selection, dark = false): AgReportState {
  const venueFilter: AgFilterState[] = selection.venue
    ? [{ field: { id: 'venues.venueId' }, model: { operator: 'equals', value: selection.venue } }]
    : [];
  const chartFilter: AgFilterState[] =
    selection.view === 'overestimated' || selection.view === 'underestimated'
      ? [
          {
            field: { id: 'history.direction' },
            model: { operator: 'equals', value: selection.view === 'overestimated' ? 'Over' : 'Under' },
          },
        ]
      : [];
  const refundFilter: AgFilterState[] =
    selection.view === 'refunds_open'
      ? [{ field: { id: 'preorders.outstanding' }, model: { operator: 'isTrue' } }]
      : [];
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.id !== state.selectedPageId
        ? page
        : {
            ...page,
            crossFilter: { values: {} },
            filter: {
              page: venueFilter,
              // Widgets the visitor added keep their own filters. Only the built in widgets follow the selection.
              widget: { ...addedFilters(page.filter?.widget), errors: chartFilter, refunds: refundFilter },
            },
            widgets: {
              ...page.widgets,
              errors: { ...page.widgets?.errors, ...chartWidget(selection.view, dark) },
            },
          },
    ),
  };
}

export function chartWidget(view: View, dark = false) {
  const paid = view === 'paid_vs_forecast';
  const color = dark ? '#EEE7DA' : '#12263A';
  return {
    type: 'bar-chart-grouped' as const,
    dataMapping: {
      categoryKey: [{ id: paid ? 'venues.venue' : 'history.label' }],
      valueKey: paid
        ? [
            { id: 'venues.forecast', aggregation: 'sum' as const },
            { id: 'venues.paid', aggregation: 'sum' as const },
            { id: 'venues.recorded', aggregation: 'sum' as const },
          ]
        : [
            { id: 'history.over', aggregation: 'sum' as const },
            { id: 'history.under', aggregation: 'sum' as const },
          ],
    },
    format: {
      title: { enabled: true, text: paid ? 'Paid units and forecast' : 'Forecast error by weekend' },
      crossFilter: 'filter' as const,
      style: {
        theme: { common: { legend: { enabled: true, position: 'bottom' as const } } },
        custom: {
          valueAxis: {
            title: { enabled: true, text: paid ? 'Units' : 'Forecast error (%)', color },
            label: { color },
          },
          categoryAxis: { label: { fontSize: 11, color, avoidCollisions: false } },
        },
      },
    },
  };
}
