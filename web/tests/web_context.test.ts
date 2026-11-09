import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/api';
import { freshCampaign, world } from '../src/mock/fixtures';
import { DEFAULT_CONTEXT, HISTORY_SHARE_PERCENT } from '../../src/domain/context';
import { contextKey, currentAnswer } from '../src/agentFresh';
import { ringTotal } from '../src/map/CityScene';
import Campaign from '../src/pages/Campaign';
import Panel from '../src/panel';
import { ClosedCampaignCard } from '../src/pages/Scorecard';
import { venues } from '../../src/data/venues';
import type { AgentView, ScorecardCampaignRow } from '../../src/shared/types';

afterEach(() => vi.unstubAllGlobals());
const onlyThis = { budget: 15000, includeRecorded: false, sharePercent: HISTORY_SHARE_PERCENT };

describe('one decision context on every screen', () => {
  it('the agent request and the close send the whole context', async () => {
    vi.stubGlobal('location', { search: '' });
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    await api.runAgent(onlyThis);
    await api.closeCampaign('mill', onlyThis);
    expect(bodies).toEqual([onlyThis, { venue: 'mill', context: onlyThis }]);
  });
  it('an answer counts only for the context and evidence it was asked for', () => {
    const answer = { pick: 'mill' } as AgentView;
    const asked = contextKey(DEFAULT_CONTEXT, '0-0');
    const stored = { key: asked, answer };
    expect(currentAnswer(stored, asked)).toBe(answer);
    expect(currentAnswer(stored, contextKey({ ...DEFAULT_CONTEXT, budget: 45000 }, '0-0'))).toBeNull();
    expect(currentAnswer(stored, contextKey({ ...DEFAULT_CONTEXT, includeRecorded: false }, '0-0'))).toBeNull();
    expect(currentAnswer(stored, contextKey({ ...DEFAULT_CONTEXT, sharePercent: 30 }, '0-0'))).toBeNull();
    expect(currentAnswer(stored, contextKey(DEFAULT_CONTEXT, '1-1'))).toBeNull();
    expect(currentAnswer(null, asked)).toBeNull();
  });
  it('the map rings leave out the recorded example when it is not included', () => {
    const v = { recordedUnits: 8, paidUnits: 3 };
    expect(ringTotal(v, true, true)).toBe(11);
    expect(ringTotal(v, true, false)).toBe(3);
    expect(ringTotal(v, false, true)).toBe(3);
  });
  it('the campaign page decides at the shared context and says it', () => {
    const html = renderToStaticMarkup(
      createElement(Campaign, { world, campaign: freshCampaign(), onChange: () => {}, context: onlyThis }),
    );
    expect(html).toContain('Forecast picks Linden Corner Shop. No paid preorders yet.');
    expect(html).toContain(`Worked out at $150, this campaign only, ${HISTORY_SHARE_PERCENT}% preorder share.`);
  });
  it('the map panel takes its evidence choice from the shared context', () => {
    const html = renderToStaticMarkup(
      createElement(Panel, {
        world,
        campaign: freshCampaign(),
        selected: 'mill',
        onSelect: () => {},
        onRefresh: async () => {},
        split: 95,
        onAgentAnswer: () => {},
        context: { ...DEFAULT_CONTEXT, includeRecorded: false },
        onContext: () => {},
      }),
    );
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="campaign"|<input[^>]*value="campaign"[^>]*checked=""/);
    expect(html).toContain('Stock budget $900.00');
  });
  it('a closed campaign card says the context its pick was worked out at', () => {
    const row: ScorecardCampaignRow = {
      id: 'c1',
      forecastPick: 'linden',
      decided: 'linden',
      paidPick: 'linden',
      paidUnits: { wharf: 1, mill: 0, linden: 0 },
      forecastWrong: false,
      paidOrders: 1,
      verdict: 'kept',
      outcomeMeasured: false,
      context: onlyThis,
      contextSaved: true,
    };
    expect(renderToStaticMarkup(createElement(ClosedCampaignCard, { campaign: row, venues }))).toContain(
      `Worked out at close: $150, this campaign only, ${HISTORY_SHARE_PERCENT}% preorder share.`,
    );
    const old = renderToStaticMarkup(
      createElement(ClosedCampaignCard, {
        campaign: { ...row, context: DEFAULT_CONTEXT, contextSaved: false },
        venues,
      }),
    );
    expect(old).toContain(
      `Worked out at the default: $900, recorded example included, ${HISTORY_SHARE_PERCENT}% preorder share.`,
    );
  });
});
