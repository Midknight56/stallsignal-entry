import { useEffect, useState } from 'react';
import { AgCharts } from 'ag-charts-react';
import { AllCommunityModule, ModuleRegistry, type AgChartOptions } from 'ag-charts-community';
import type { ColDef } from 'ag-grid-community';
import type {
  ScorecardView,
  ScorecardHistoryRow,
  CampaignView,
  ScorecardCampaignRow,
  Venue,
} from '../../../src/shared/types';
import { getScorecard } from '../api';
import { errorText, shortCampaignId, venueName } from '../format';
import { useDark } from '../theme';
import type { MapWorld } from '../world';
import { closedCampaign } from '../../../src/domain/scorecard';
import { DEFAULT_CONTEXT, contextLabel, type DecisionContext } from '../../../src/domain/context';
import { scenarioOf } from '../decision';
import DecisionCost from '../components/DecisionCost';
import Grid from '../components/Grid';
import ExampleTag from '../components/ExampleTag';
ModuleRegistry.registerModules([AllCommunityModule]);
export function prepareClosedCampaigns(
  recordedRow: ScorecardCampaignRow | null,
  liveCampaigns: ScorecardCampaignRow[] = [],
  recordedId?: string,
  recordedCampaignId?: string,
): (ScorecardCampaignRow & { isRecorded: boolean })[] {
  const filtered = liveCampaigns
    .filter((c) => c.id !== recordedId && c.id !== recordedCampaignId)
    .slice()
    .sort((a, b) => {
      const ta = a.closedAt ? Date.parse(a.closedAt) : 0;
      const tb = b.closedAt ? Date.parse(b.closedAt) : 0;
      return tb - ta;
    })
    .slice(0, 5);
  return [
    ...(recordedRow ? [{ ...recordedRow, isRecorded: true }] : []),
    ...filtered.map((c) => ({ ...c, isRecorded: false })),
  ];
}
export function ForecastErrorCell({ value }: { value: number }) {
  return (
    <span className={value >= 0 ? 'forecast' : 'paid'}>
      {Math.abs(value).toFixed(1)}% {value >= 0 ? 'over' : 'under'}
    </span>
  );
}
export function ClosedCampaignCard({
  campaign: c,
  venues,
}: {
  campaign: ScorecardCampaignRow & { isRecorded?: boolean };
  venues: Venue[];
}) {
  const verdict = c.verdict ?? (c.paidOrders === 0 ? 'no_evidence' : c.forecastWrong ? 'changed' : 'kept');
  const verdictText =
    verdict === 'no_evidence'
      ? 'No paid evidence.'
      : verdict === 'changed'
        ? 'Paid demand changed the pick.'
        : 'Paid demand kept the forecast pick.';
  return (
    <article key={c.id} className="card">
      <h3>
        {c.isRecorded ? (
          'Recorded sandbox run'
        ) : (
          <>
            Sandbox campaign <span className="muted">{shortCampaignId(c.id)}</span>
          </>
        )}
      </h3>
      <p className="evidence-source">
        {c.isRecorded ? 'Recorded sandbox run' : 'Sandbox payments in this campaign'}
      </p>
      <p>
        {c.closedAt ? (
          <time dateTime={c.closedAt}>
            {new Date(c.closedAt).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </time>
        ) : (
          'Date not recorded'
        )}
      </p>
      <span className={`chip ${verdict === 'changed' ? 'forecast' : 'paid'}`}>
        {verdictText}
      </span>
      <p className="muted">Outcome not measured. The app does not record what sold at the event.</p>
      <p>
        <ExampleTag /> Forecast pick: {venueName(venues, c.forecastPick)}. Paid pick:{' '}
        {venueName(venues, c.paidPick ?? c.decided)}. Chosen:{' '}
        {venueName(venues, c.decided)}.
      </p>
      <p className="small">
        {c.contextSaved ? 'Worked out at close: ' : 'Worked out at the default: '}
        {contextLabel(c.context ?? DEFAULT_CONTEXT)}.
      </p>
      <p>
        {c.preorderCount ?? 0} {(c.preorderCount ?? 0) === 1 ? 'preorder' : 'preorders'}.{' '}
        {c.refundCount ?? 0} {(c.refundCount ?? 0) === 1 ? 'refund' : 'refunds'}.
      </p>
    </article>
  );
}
export default function Scorecard({
  world,
  campaign,
  context = DEFAULT_CONTEXT,
}: {
  world: MapWorld;
  campaign: CampaignView;
  context?: DecisionContext;
}) {
  const [data, setData] = useState<ScorecardView | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const dark = useDark();
  useEffect(() => {
    let active = true;
    getScorecard()
      .then((d) => {
        if (active) {
          setData(d);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const options: AgChartOptions = {
    data: data?.history.map((r) => ({
      ...r,
      label: `${r.venue === 'wharf' ? 'Wharf' : r.venue === 'mill' ? 'Mill' : 'Linden'}, ${r.season}`,
    })),
    title: { text: 'Synthetic history' },
    subtitle: { text: 'Forecast vs actual units' },
    background: { fill: dark ? '#16283A' : '#F6F1E7' },
    theme: {
      baseTheme: dark ? 'ag-default-dark' : 'ag-default',
      palette: { fills: ['#E2572B', '#1F8A84'], strokes: ['#E2572B', '#1F8A84'] },
    },
    series: [
      { type: 'bar', direction: 'horizontal', xKey: 'label', yKey: 'forecastUnits', yName: 'Forecast units' },
      { type: 'bar', direction: 'horizontal', xKey: 'label', yKey: 'actualUnits', yName: 'Actual units' },
    ],
    axes: {
      y: { type: 'category', label: { fontSize: 11 } },
      x: { type: 'number', title: { text: 'Units' } },
    },
  };
  const columns: ColDef<ScorecardHistoryRow>[] = [
    {
      field: 'venue',
      headerName: 'Venue',
      valueFormatter: (p) => venueName(world.venues, p.value),
      minWidth: 190,
    },
    { field: 'season', headerName: 'Season' },
    { field: 'forecastUnits', headerName: 'Forecast units' },
    { field: 'actualUnits', headerName: 'Actual units' },
    { field: 'preorderUnits', headerName: 'Preorder units' },
    {
      field: 'errorPercent',
      headerName: 'Forecast error',
      minWidth: 160,
      cellRenderer: (p: { value: number }) => <ForecastErrorCell value={p.value} />,
    },
  ];
  const recorded = world.recorded;
  const recordedRow =
    recorded?.recordedAt && recorded.chosen
      ? closedCampaign(recorded.id, recorded.preorders, recorded.chosen, recorded.recordedAt)
      : null;
  const campaigns = prepareClosedCampaigns(
    recordedRow,
    data?.campaigns ?? [],
    recorded?.id,
    (recorded as { campaignId?: string } | null)?.campaignId,
  );
  return (
    <main className="page">
      <p className="eyebrow">Evidence in the open</p>
      <h1>What paid demand changed</h1>
      <section aria-labelledby="campaigns-caption">
        <h2 id="campaigns-caption">Closed campaigns</h2>
        {campaigns.length === 0 && <p>No closed campaigns yet.</p>}
        {campaigns.map((c) => (
          <ClosedCampaignCard key={c.id} campaign={c} venues={world.venues} />
        ))}
      </section>
      <section aria-labelledby="current-caption">
        <h2 id="current-caption">Current campaign</h2>
        <p className="small">Worked out at {contextLabel(context)}.</p>
        <DecisionCost campaign={campaign} venues={world.venues} budget={context.budget} scenario={scenarioOf(context)} />
      </section>
      {error && (
        <p role="alert" className="error">
          {error} <button onClick={() => setAttempt(attempt + 1)}>Try again</button>
        </p>
      )}
      {!data && !error && <p role="status">Loading scorecard…</p>}
      {data && (
        <>
          <h2 id="history-caption">Synthetic history</h2>
          <p>The past weekends are invented to show forecast error on synthetic history.</p>
          <div className="chart card">
            <AgCharts options={options} />
          </div>
          <section aria-labelledby="history-caption">
            <Grid
              rows={data.history}
              columns={columns}
              label="Synthetic history, forecast and actual table"
            />
          </section>
          <div className="totals">
            {data.perVenue.map((v) => (
              <article className="card" key={v.venue}>
                <h3>{venueName(world.venues, v.venue)}</h3>
                <p>{v.meanAbsoluteError.toFixed(1)}% mean absolute error</p>
                <span className="small">Synthetic history</span>
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
