import { useRef, useState } from 'react';
import type { CampaignView, VenueId, World } from '../../../src/shared/types';
import { expectedMargin } from '../../../src/domain/forecast';
import { money } from '../format';
import { comparisonLine, comparisonPick } from '../comparison';
import type { AgentSource } from '../agentStatus';
import { recordingTime } from '../world';
import { nextSheetHeight, sheetHeights, type SheetHeight } from '../layout';
import DecisionCost from '../components/DecisionCost';
import WhatChanges from '../components/WhatChanges';
import { panelDecision } from '../decision';
import { scenarioOf } from '../decision';
import { DEFAULT_CONTEXT, HISTORY_SHARE_PERCENT, type DecisionContext } from '../../../src/domain/context';
import AgentPanel from './AgentPanel';
import PreorderSheet from './PreorderSheet';
export default function Panel({
  world,
  campaign,
  selected,
  onSelect,
  onRefresh,
  split,
  onAgentAnswer,
  context = DEFAULT_CONTEXT,
  onContext = () => {},
}: {
  world: World;
  campaign: CampaignView;
  selected: VenueId;
  onSelect: (v: VenueId) => void;
  onRefresh: () => Promise<void>;
  split: number;
  onAgentAnswer: (source: AgentSource) => void;
  context?: DecisionContext;
  onContext?: (c: DecisionContext) => void;
}) {
  const [height, setHeight] = useState<SheetHeight>('middle'),
    [preorder, setPreorder] = useState(false);
  // One shared decision context (budget, evidence choice, share) drives every number on this panel, the map,
  // the agent and the campaign page.
  const { budget, includeRecorded, sharePercent } = context;
  const historySharePercent = HISTORY_SHARE_PERCENT;
  const setIncludeRecorded = (v: boolean) => onContext({ ...context, includeRecorded: v });
  const setSharePercent = (v: number) => onContext({ ...context, sharePercent: v });
  const scenario = scenarioOf(context);
  const view = panelDecision(campaign, scenario);
  // With no paid orders counted, the paid side has no evidence: say what the forecast picks.
  const counted = campaign.paidOrders + (includeRecorded ? campaign.recordedOrders : 0);
  const side = counted === 0 ? 0 : split;
  const drag = useRef(0);
  const dragged = useRef(false);
  const selectedName = world.venues.find((v) => v.id === selected)?.name ?? selected;
  const evidenceKey = `${campaign.venues.reduce((s, v) => s + v.paidUnits, 0)}-${campaign.preorders.filter((p) => p.state === 'captured').length}`;
  return (
    <aside className={`home-panel sheet-${height}`} aria-label="Venue evidence and stock plan">
      <button
        className="sheet-handle"
        aria-label={`Panel height ${height}. Press to change height`}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          setHeight(sheetHeights[(sheetHeights.indexOf(height) + 1) % 3]);
        }}
        onPointerDown={(e) => {
          drag.current = e.clientY;
          dragged.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (Math.abs(e.clientY - drag.current) > 35) {
            dragged.current = true;
            setHeight(nextSheetHeight(height, e.clientY - drag.current));
            e.preventDefault();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setHeight(nextSheetHeight(height, e.key === 'ArrowUp' ? -100 : 100));
          }
        }}
      >
        <span />
      </button>
      <div className="panel-scroll">
        <section className="decision-block" aria-label="Decision">
          <p className="eyebrow">One weekend. Three places.</p>
          <h2>Let paid demand decide.</h2>
          <p className="decision">{comparisonLine(view, world.venues, side, budget)}</p>
          <p className="selected-venue">
            Selected venue <strong>{selectedName}</strong>
          </p>
          {preorder ? (
            <PreorderSheet
              key={selected}
              world={world}
              campaign={campaign}
              venue={selected}
              onClose={() => setPreorder(false)}
              onRefresh={onRefresh}
            />
          ) : (
            <button
              className="primary"
              onClick={() => setPreorder(true)}
              disabled={campaign.state !== 'open' || campaign.checking}
            >
              Preorder at this venue
            </button>
          )}
          {campaign.checking && (
            <p className="banner" role="status">
              Checking payment
            </p>
          )}
          <p className="budget">Stock budget {money(budget)}</p>
          <p className="captured">Captured in this campaign: {money(campaign.capturedCents)} (not refunded)</p>
          <DecisionCost campaign={campaign} venues={world.venues} budget={budget} scenario={scenario} />
        </section>
        <WhatChanges
          campaign={campaign}
          venues={world.venues}
          catalog={world.catalog}
          budget={budget}
          includeRecorded={includeRecorded}
          onIncludeRecorded={setIncludeRecorded}
          sharePercent={sharePercent}
          share={scenario.share}
          onSharePercent={setSharePercent}
          historySharePercent={historySharePercent}
        />
        <div className="venue-cards">
          {world.venues.map((v) => {
            const data = view.venues.find((s) => s.id === v.id);
            return (
              data && (
                <section className={`venue-card ${selected === v.id ? 'selected' : ''}`} key={v.id}>
                  <button
                    className="venue-choice"
                    onClick={() => {
                      onSelect(v.id);
                      setPreorder(false);
                    }}
                    aria-pressed={selected === v.id}
                  >
                    <span className="eyebrow">{v.district}</span>
                    <strong>{v.name}</strong>
                    {comparisonPick(view, side) === v.id && (
                      <span className={`chip ${side < 50 ? 'forecast' : 'paid'}`}>Current pick</span>
                    )}
                  </button>
                  <dl className="unit-split">
                    <div>
                      <dt className="forecast">Forecast units</dt>
                      <dd>{data.forecastUnits}</dd>
                    </div>
                    <div>
                      <dt className="recorded">Recorded units</dt>
                      <dd>{data.recordedUnits}</dd>
                    </div>
                    <div>
                      <dt className="paid">Your campaign units</dt>
                      <dd>{data.paidUnits}</dd>
                    </div>
                  </dl>
                  <details className="venue-details">
                    <summary>Venue details</summary>
                    <dl>
                      {data.pendingUnits > 0 && (
                        <div>
                          <dt className="pending">Pending units</dt>
                          <dd>{data.pendingUnits}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Blended units</dt>
                        <dd>{Math.round(data.blendedUnits)}</dd>
                      </div>
                      <div>
                        <dt>Estimated margin</dt>
                        <dd>{money(expectedMargin(v.id, data.blendedUnits, budget))}</dd>
                      </div>
                    </dl>
                  </details>
                </section>
              )
            );
          })}
        </div>
        {!recordingTime(world) && <p className="small">Recorded run not captured yet</p>}
        <p className="small">
          Recorded paid demand and your live paid demand shape the choice.
        </p>
        <AgentPanel
          world={world}
          context={context}
          onContext={onContext}
          evidenceKey={evidenceKey}
          onAnswer={onAgentAnswer}
        />
      </div>
    </aside>
  );
}
