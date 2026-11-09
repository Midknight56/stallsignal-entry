import { describe, expect, it } from 'vitest';
import { agentStatus } from '../src/agentStatus';
import { comparisonLine, comparisonPick } from '../src/comparison';
import { freshCampaign, world } from '../src/mock/fixtures';
import { expectedMargin } from '../../src/domain/forecast';
import { money } from '../src/format';

describe('session agent status', () => {
  it('uses availability only before an answer', () => {
    expect(agentStatus(null, true)).toBe('Agent ready');
    expect(agentStatus(null, false)).toBe('Recorded run');
    expect(agentStatus(null)).toBe('Recorded run');
  });
  it.each([
    ['ai', 'Live AI'],
    ['cache', 'Saved from a live answer'],
    ['recorded', 'Recorded run'],
    ['code', 'Code pick'],
  ] as const)('labels %s regardless of availability', (source, label) => {
    expect(agentStatus(source, true)).toBe(label);
    expect(agentStatus(source, false)).toBe(label);
  });
});
describe('comparison decision', () => {
  const campaign = freshCampaign();
  it.each([0, 5, 49.99])('uses forecast below 50 (%s)', (split) => {
    expect(comparisonPick(campaign, split)).toBe(campaign.forecastPick);
    const row = campaign.venues.find((v) => v.id === campaign.forecastPick)!;
    expect(comparisonLine(campaign, world.venues, split)).toBe(
      `Forecast picks Shed 9: ${money(expectedMargin(row.id, row.forecastUnits))} margin on the forecast alone.`,
    );
  });
  it.each([50, 95, 100])('uses paid decision from 50 (%s)', (split) => {
    expect(comparisonPick(campaign, split)).toBe(campaign.decided);
    const row = campaign.venues.find((v) => v.id === campaign.decided)!;
    expect(comparisonLine(campaign, world.venues, split)).toBe(
      `Preorders pick Millrace Hall: ${money(row.marginCents)} margin on today's evidence.`,
    );
  });
  it('uses changed campaign values instead of fixed venue names or margins', () => {
    const changed = {
      ...campaign,
      forecastPick: 'linden',
      decided: 'wharf',
      venues: campaign.venues.map((v) => ({ ...v, forecastUnits: 23, marginCents: 12345 })),
    } as typeof campaign;
    expect(comparisonLine(changed, world.venues, 5)).toContain('Forecast picks Linden Corner Shop:');
    expect(comparisonLine(changed, world.venues, 95)).toBe(
      "Preorders pick Shed 9: $4.97 margin on today's evidence.",
    );
  });
  it('comparisonLine with budget 45000 differs from 90000 for a case where the margin depends on budget', () => {
    const line45 = (comparisonLine as (c: unknown, v: unknown, s: number, b?: number) => string)(campaign, world.venues, 95, 45000);
    const line90 = (comparisonLine as (c: unknown, v: unknown, s: number, b?: number) => string)(campaign, world.venues, 95, 90000);
    expect(line45).not.toBe(line90);
  });
});
