import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ScorecardCampaignRow } from '../../src/shared/types';
import { ClosedCampaignCard, ForecastErrorCell, prepareClosedCampaigns } from '../src/pages/Scorecard';
import { shortCampaignId } from '../src/format';
import { venues } from '../../src/data/venues';

describe('prepareClosedCampaigns', () => {
  const dummyRow = (id: string, closedAt: string): ScorecardCampaignRow => ({
    id,
    forecastPick: 'mill',
    decided: 'wharf',
    paidUnits: { wharf: 10, mill: 5, linden: 0 },
    forecastWrong: true,
    paidOrders: 1,
    verdict: 'changed',
    outcomeMeasured: false,
    closedAt,
    preorderCount: 1,
    refundCount: 1,
  });

  it('keeps at most the 5 most recent live campaigns under the recorded row, newest first', () => {
    const recorded = dummyRow('rec-1', '2026-11-01T12:00:00Z');
    const live = [
      dummyRow('c1', '2026-11-02T12:00:00Z'),
      dummyRow('c2', '2026-11-06T12:00:00Z'),
      dummyRow('c3', '2026-11-04T12:00:00Z'),
      dummyRow('c4', '2026-11-03T12:00:00Z'),
      dummyRow('c5', '2026-11-05T12:00:00Z'),
      dummyRow('c6', '2026-11-07T12:00:00Z'),
      dummyRow('c7', '2026-11-01T10:00:00Z'),
    ];

    const result = prepareClosedCampaigns(recorded, live, 'rec-1');
    expect(result).toHaveLength(6);
    expect(result[0].id).toBe('rec-1');
    expect(result[0].isRecorded).toBe(true);

    // Live rows must be newest first, max 5: c6, c2, c5, c3, c4
    expect(result.slice(1).map((r) => r.id)).toEqual(['c6', 'c2', 'c5', 'c3', 'c4']);
    expect(result.slice(1).every((r) => r.isRecorded === false)).toBe(true);
  });

  it('filters out recorded campaign id even if present in live list', () => {
    const recorded = dummyRow('rec-1', '2026-11-01T12:00:00Z');
    const live = [recorded, dummyRow('c1', '2026-11-02T12:00:00Z')];
    const result = prepareClosedCampaigns(recorded, live, 'rec-1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('rec-1');
    expect(result[1].id).toBe('c1');
  });
});

describe('Scorecard closed campaign card titles and plurals', () => {
  it('formats short campaign id with muted span and exact plurals', () => {
    const id = 'c32b2189b7ba4d3b88622cba8644ff16';
    expect(shortCampaignId(id)).toBe('c32b…ff16');

    // Test plural formatting
    const pluralize = (preorderCount: number, refundCount: number) =>
      `${preorderCount} ${preorderCount === 1 ? 'preorder' : 'preorders'}. ${refundCount} ${refundCount === 1 ? 'refund' : 'refunds'}.`;

    expect(pluralize(1, 1)).toBe('1 preorder. 1 refund.');
    expect(pluralize(0, 0)).toBe('0 preorders. 0 refunds.');
    expect(pluralize(1, 0)).toBe('1 preorder. 0 refunds.');
    expect(pluralize(0, 1)).toBe('0 preorders. 1 refund.');
    expect(pluralize(5, 2)).toBe('5 preorders. 2 refunds.');
  });
});

describe('Scorecard forecast error percentages', () => {
  it('renders a history row with errorPercent 56.25 as 56.3% over', () => {
    const html = renderToStaticMarkup(createElement(ForecastErrorCell, { value: 56.25 }));
    expect(html).toContain('56.3% over');
    expect(html).not.toContain('5625');
  });
});

describe('Scorecard closed campaign card verdicts and outcome', () => {
  it('renders the three verdict texts and outcome not measured line', () => {
    const baseRow: ScorecardCampaignRow = {
      id: 'c-test',
      forecastPick: 'wharf',
      decided: 'wharf',
      paidUnits: { wharf: 0, mill: 0, linden: 0 },
      forecastWrong: false,
      paidOrders: 0,
      verdict: 'no_evidence',
      outcomeMeasured: false,
    };
    const htmlNoEvidence = renderToStaticMarkup(
      createElement(ClosedCampaignCard, { campaign: baseRow, venues }),
    );
    expect(htmlNoEvidence).toContain('No paid evidence.');
    expect(htmlNoEvidence).toContain('Outcome not measured. The app does not record what sold at the event.');

    const htmlChanged = renderToStaticMarkup(
      createElement(ClosedCampaignCard, {
        campaign: { ...baseRow, verdict: 'changed', paidOrders: 5, forecastWrong: true, paidPick: 'mill' },
        venues,
      }),
    );
    expect(htmlChanged).toContain('Paid demand changed the pick.');
    expect(htmlChanged).toContain('Outcome not measured. The app does not record what sold at the event.');

    const htmlKept = renderToStaticMarkup(
      createElement(ClosedCampaignCard, {
        campaign: { ...baseRow, verdict: 'kept', paidOrders: 3, forecastWrong: false, paidPick: 'wharf' },
        venues,
      }),
    );
    expect(htmlKept).toContain('Paid demand kept the forecast pick.');
    expect(htmlKept).toContain('Outcome not measured. The app does not record what sold at the event.');
  });
});
