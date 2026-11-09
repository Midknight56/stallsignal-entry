import { createContext, useContext } from 'react';
import { createWidgets } from 'ag-studio-react';
import type { AgWidgetFormParams } from 'ag-studio';
import type { ColDef } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useDark } from '../theme';
import { evidenceColumns, EVIDENCE_ROW_HEIGHT } from './evidence';
import type { CampaignView, VenueId } from '../../../src/shared/types';
import type { MapWorld } from '../world';
import CityScene from '../map/CityScene';
import { money } from '../format';
import { filterTables, type Selection } from './filter';
import type { StudioTables } from './data';

export const DashboardContext = createContext<{
  world: MapWorld;
  campaign: CampaignView;
  tables: StudioTables;
  selection: Selection;
  selectVenue: (venue: VenueId) => void;
} | null>(null);
function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error('Dashboard data is unavailable');
  return value;
}

function MapWidget() {
  const { world, campaign, tables, selection, selectVenue } = useDashboard();
  return (
    <section className="studio-map-widget" aria-label="Venue map">
      <div className="studio-map-caption">
        <span className="chip">Real streets</span>
      </div>
      <CityScene
        world={world}
        campaign={campaign}
        selected={selection.venue}
        onSelect={selectVenue}
        pinLabelSuffix=" on map"
        interactivePins
      />
      <div className="studio-map-key">
        <span className="forecast">Orange: forecast</span>
        <span className="paid">Teal: paid evidence</span>
        <span>Heat: daytime workers, 2024</span>
        <span>Synthetic history</span>
        <span>Map data: U.S. Census Bureau (TIGER/Line 2025, LODES 8.5).</span>
      </div>
      <div className="studio-map-venues">
        {tables.venues.map((v) => (
          <button
            key={v.venueId}
            aria-pressed={selection.venue === v.venueId}
            onClick={() => selectVenue(v.venueId)}
          >
            <strong>{v.venueId === 'wharf' ? 'Shed 9' : v.name}</strong>
            <span>
              {v.forecast} forecast · {v.paid} live · {v.recorded} recorded
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RefundWidget() {
  const { tables, selection, selectVenue } = useDashboard();
  const filtered = filterTables(tables, selection);
  const total = filtered.preorders.reduce((sum, row) => sum + row.liabilityCents, 0);
  return (
    <section className="studio-refunds" aria-label="Refund liability by venue">
      <div className="studio-refund-total">
        <strong>{money(total)}</strong>
        <span>Outstanding refunds · USD</span>
      </div>
      {filtered.venues.map((v) => {
        const rows = filtered.preorders.filter((p) => p.venueId === v.venueId);
        const open = rows.filter((p) => p.outstanding);
        return (
          <div key={v.venueId} className="studio-refund-venue">
            <button onClick={() => selectVenue(v.venueId)} aria-pressed={selection.venue === v.venueId}>
              <strong>{v.name}</strong>
              <strong>{money(open.reduce((sum, p) => sum + p.amountCents, 0))}</strong>
            </button>
            {!open.length && <p className="small">No open refunds</p>}
            {rows.map((p) => (
              <div
                className={`studio-refund-payment ${p.state === 'refund_failed' ? 'failed' : ''}`}
                key={p.id}
              >
                <span>
                  {p.stateLabel} · {money(p.amountCents)}
                </span>
                <span className="small">
                  {p.source} · {p.id}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

ModuleRegistry.registerModules([AllCommunityModule]);

function EvidenceWidget() {
  const { tables, selection, selectVenue } = useDashboard();
  const dark = useDark();
  const rows = filterTables(tables, selection).evidence;
  const theme = themeQuartz.withParams({
    backgroundColor: dark ? '#16283A' : '#FFFCF5',
    foregroundColor: dark ? '#EEE7DA' : '#12263A',
    headerBackgroundColor: dark ? '#0E1B29' : '#F6F1E7',
    borderColor: dark ? '#3B5364' : '#D8CFBF',
    accentColor: '#1F8A84',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    rowHeight: EVIDENCE_ROW_HEIGHT,
  });
  // Evidence is already loaded. Keep its plain field keys and row height explicit in the client grid.
  return (
    <div className="studio-evidence-grid ag-studio-grid-widget" role="region" aria-label="Evidence grid">
      <AgGridReact
        theme={theme}
        rowData={rows}
        columnDefs={evidenceColumns}
        defaultColDef={{ sortable: true, resizable: true }}
        domLayout="autoHeight"
        rowHeight={EVIDENCE_ROW_HEIGHT}
        headerHeight={48}
        getRowId={({ data }) => data.id}
        onCellClicked={({ data }) => {
          if (data) selectVenue(data.venueId);
        }}
        onCellKeyDown={({ data, event }) => {
          if (data && event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            selectVenue(data.venueId);
          }
        }}
      />
    </div>
  );
}

const pendingPaymentColumns: ColDef[] = [
  { field: 'venue', headerName: 'Venue', minWidth: 160, flex: 1 },
  { field: 'state', headerName: 'State', minWidth: 110, flex: 1 },
  {
    field: 'amount',
    headerName: 'Amount',
    minWidth: 100,
    flex: 1,
    valueFormatter: ({ value }) => (typeof value === 'number' ? `$${value.toFixed(2)}` : String(value ?? '')),
  },
  {
    field: 'orderId',
    headerName: 'Order ID',
    minWidth: 160,
    flex: 1,
    valueFormatter: ({ value }) => value ?? 'None',
  },
];

function PendingPaymentsWidget() {
  const { tables, selection } = useDashboard();
  const dark = useDark();
  const unsettledStates = ['draft', 'creating', 'created', 'approved', 'capturing', 'checking', 'pending'];
  const rows = filterTables(tables, selection).preorders.filter((p) => unsettledStates.includes(p.state));
  const theme = themeQuartz.withParams({
    backgroundColor: dark ? '#16283A' : '#FFFCF5',
    foregroundColor: dark ? '#EEE7DA' : '#12263A',
    headerBackgroundColor: dark ? '#0E1B29' : '#F6F1E7',
    borderColor: dark ? '#3B5364' : '#D8CFBF',
    accentColor: '#1F8A84',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    rowHeight: EVIDENCE_ROW_HEIGHT,
  });
  return (
    <div className="studio-pending-grid ag-studio-grid-widget" role="region" aria-label="Pending payments">
      <AgGridReact
        theme={theme}
        rowData={rows}
        columnDefs={pendingPaymentColumns}
        defaultColDef={{ sortable: true, resizable: true }}
        domLayout="autoHeight"
        rowHeight={EVIDENCE_ROW_HEIGHT}
        headerHeight={48}
        getRowId={({ data }) => data.id}
      />
    </div>
  );
}

function GridWidgetDispatcher(props?: { widgetId?: string }) {
  if (props?.widgetId && props.widgetId !== 'evidence') {
    return <PendingPaymentsWidget />;
  }
  return <EvidenceWidget />;
}

export const customWidgets = createWidgets({
  overrides: [{ id: 'grid', comp: GridWidgetDispatcher }],
  additionalTypes: [
    {
      id: 'portland-map',
      label: 'Portland, Maine',
      comp: MapWidget,
      dataMapping: {},
      form: (params: AgWidgetFormParams) => params.createDefaults({}),
      defaultSize: { width: 640, height: 600 },
      minSize: { width: 260, height: 250 },
    },
    {
      id: 'refund-liability',
      label: 'Refund liability',
      comp: RefundWidget,
      dataMapping: {},
      form: (params: AgWidgetFormParams) => params.createDefaults({}),
      defaultSize: { width: 420, height: 230 },
      minSize: { width: 260, height: 160 },
    },
  ],
} as never);
