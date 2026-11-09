import { describe, it, expect } from 'vitest';
import { decisionLine, errorText, money, shortCampaignId, shortId, stateLabel } from '../src/format';
import { freshCampaign, world } from '../src/mock/fixtures';
import { recordingTime } from '../src/world';
describe('plain labels and catalog money', () => {
  it('uses cents without losing sign or zero', () => {
    expect(money(1400)).toBe('$14.00');
    expect(money(0)).toBe('$0.00');
    expect(money(-18000)).toBe('-$180.00');
  });
  it('says the exact decision line', () => {
    expect(decisionLine({ ...freshCampaign(), decided: 'mill' }, world.venues)).toBe(
      'Forecast picks Shed 9. Preorders pick Millrace Hall.',
    );
  });
  it('says when forecast and paid preorders agree', () => {
    expect(decisionLine({ ...freshCampaign(), decided: 'wharf' }, world.venues)).toBe(
      'Forecast and preorders agree: Shed 9.',
    );
  });
  it('does not imply paid demand without evidence', () => {
    const c = freshCampaign();
    c.venues.forEach((v) => {
      v.recordedUnits = 0;
      v.paidUnits = 0;
    });
    expect(decisionLine(c, world.venues)).toBe('Forecast picks Shed 9. No paid preorders yet.');
  });
  it('does not expose server errors', () => {
    expect(errorText(new Error('{secret:debug}'))).toBe(
      'We could not finish that request. Please try again.',
    );
    expect(errorText(new Error('NOT_YOUR_CAMPAIGN'))).toContain('another session');
  });
  it('names the checking state and shortens long ids', () => {
    expect(stateLabel('checking')).toBe('Checking payment');
    expect(shortId(null)).toBe('Not yet');
    expect(shortId('1234567890123456789012345')).toContain('…');
    expect(shortCampaignId('c32b2189b7ba4d3b88622cba8644ff16')).toBe('c32b…ff16');
    expect(shortCampaignId('short')).toBe('short');
    expect(shortCampaignId(null)).toBe('');
  });
  it('never invents a recording date', () => {
    expect(recordingTime({ ...world, recorded: null })).toBeNull();
    expect(recordingTime(world)).toBe('2026-11-06T12:00:00Z');
  });
});

it('dates a saved live answer only when its capture time is supplied', async () => {
  const { sourceLabel, time } = await import('../src/format');
  expect(sourceLabel('cache')).toBe('Saved from a live answer');
  expect(sourceLabel('cache', 'invalid')).toBe('Saved from a live answer');
  expect(sourceLabel('cache', '2026-11-06T12:00:00Z')).toBe(
    `Saved from a live answer, ${time('2026-11-06T12:00:00Z')}`,
  );
});

it('sourceLabel returns the exact fallback text for each code answer fallback', async () => {
  const { sourceLabel } = await import('../src/format');
  const sl = sourceLabel as (s: string, c?: string, f?: string) => string;
  expect(sl('code', undefined, 'model_off')).toBe('Code pick. The model is off right now.');
  expect(sl('code', undefined, 'run_limit')).toBe("Code pick. You have used today's agent runs.");
  expect(sl('code', undefined, 'daily_budget')).toBe("Code pick. Today's free model budget is used up.");
  expect(sl('code', undefined, 'check_failed')).toBe("Code pick. The model's answer failed a check.");
  expect(sl('code', undefined, 'error')).toBe('Code pick. The model could not be reached.');
  expect(sl('code', undefined, undefined)).toBe('Code pick (model answer failed a check)');
});
