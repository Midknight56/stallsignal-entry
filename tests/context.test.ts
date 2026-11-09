import { describe, expect, it } from 'vitest';
import recordedData from '../src/data/recorded.json';
import type { Preorder } from '../src/shared/types';
import { PREORDER_SHARE } from '../src/data/history';
import { decide } from '../src/domain/blend';
import { cacheKey } from '../src/agent/run';
import { codeAnswer } from '../src/agent/answer';
import { closedCampaign } from '../src/domain/scorecard';
import {
  DEFAULT_CONTEXT,
  HISTORY_SHARE_PERCENT,
  SHARE_CHOICES,
  contextLabel,
  evidenceFor,
  parseContext,
  shareOf,
} from '../src/domain/context';

const recorded = recordedData.preorders as Preorder[];
const wharfOrder: Preorder = {
  ...recorded[0],
  id: 'w1',
  venue: 'wharf',
  qty: 1,
  source: 'live',
  state: 'captured',
  captureId: 'c-w1',
};

describe('one decision context', () => {
  it('parses the default, a full context, and refuses anything off the controls', () => {
    expect(parseContext({})).toEqual(DEFAULT_CONTEXT);
    expect(DEFAULT_CONTEXT).toEqual({ budget: 90000, includeRecorded: true, sharePercent: HISTORY_SHARE_PERCENT });
    expect(parseContext({ budget: 45000, includeRecorded: false, sharePercent: 20 })).toEqual({
      budget: 45000,
      includeRecorded: false,
      sharePercent: 20,
    });
    for (const bad of [
      { budget: 45001 },
      { budget: 10000 },
      { sharePercent: 15 },
      { sharePercent: '20' },
      { includeRecorded: 'no' },
    ])
      expect(parseContext(bad)).toBeNull();
    expect(SHARE_CHOICES).toEqual([...new Set([10, HISTORY_SHARE_PERCENT, 20, 30])].sort((a, z) => a - z));
  });
  it('uses the exact history share for the history choice', () => {
    expect(shareOf(HISTORY_SHARE_PERCENT)).toBe(PREORDER_SHARE);
    expect(shareOf(20)).toBe(0.2);
  });
  it('the agent evidence follows the evidence choice and the share', () => {
    const off = evidenceFor({ budget: 90000, includeRecorded: false, sharePercent: 30 }, [], recorded);
    expect(off).toEqual({ budget: 90000, preorders: [], recorded: [], share: 0.3 });
    expect(evidenceFor(DEFAULT_CONTEXT, [], recorded).recorded).toBe(recorded);
  });
  it('the code answer picks what the panel picks for this campaign only', () => {
    expect(codeAnswer(evidenceFor({ ...DEFAULT_CONTEXT, includeRecorded: false }, [], recorded)).pick).toBe('wharf');
    expect(
      codeAnswer(evidenceFor({ ...DEFAULT_CONTEXT, budget: 15000, includeRecorded: false }, [], recorded)).pick,
    ).toBe('linden');
    expect(codeAnswer(evidenceFor(DEFAULT_CONTEXT, [], recorded)).pick).toBe('mill');
  });
  it('the share reaches the decision', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...wharfOrder, id: `m${i}` }));
    const a = decide(many, 90000, [], PREORDER_SHARE).venues.find((v) => v.id === 'wharf')!.blendedUnits;
    const b = decide(many, 90000, [], 0.3).venues.find((v) => v.id === 'wharf')!.blendedUnits;
    expect(a).not.toBe(b);
  });
  it('the agent cache key changes with the share and the evidence choice', async () => {
    const base = evidenceFor(DEFAULT_CONTEXT, [], recorded);
    const key = await cacheKey(base);
    expect(await cacheKey(evidenceFor({ ...DEFAULT_CONTEXT, sharePercent: 30 }, [], recorded))).not.toBe(key);
    expect(await cacheKey(evidenceFor({ ...DEFAULT_CONTEXT, includeRecorded: false }, [], recorded))).not.toBe(key);
    expect(await cacheKey(evidenceFor(DEFAULT_CONTEXT, [], recorded))).toBe(key);
  });
  it('says the context in plain words', () => {
    expect(contextLabel({ budget: 15000, includeRecorded: false, sharePercent: HISTORY_SHARE_PERCENT })).toBe(
      `$150, this campaign only, ${HISTORY_SHARE_PERCENT}% preorder share`,
    );
    expect(contextLabel({ budget: 90000, includeRecorded: true, sharePercent: 20 })).toBe(
      '$900, recorded run included, 20% preorder share',
    );
  });
  it('a closed campaign keeps the decision the maker saw', () => {
    const saved = {
      context: { budget: 15000, includeRecorded: false, sharePercent: HISTORY_SHARE_PERCENT },
      forecastPick: 'linden' as const,
      paidPick: 'linden' as const,
    };
    const row = closedCampaign('c1', [wharfOrder], 'linden', null, [], saved);
    expect(row).toMatchObject({ paidPick: 'linden', forecastPick: 'linden', contextSaved: true, verdict: 'kept' });
    expect(row.context).toEqual(saved.context);
    const old = closedCampaign('c0', [wharfOrder], 'wharf', null);
    expect(old).toMatchObject({ paidPick: 'wharf', contextSaved: false, context: DEFAULT_CONTEXT });
    // A saved pick with no paid orders of its own is still no evidence.
    expect(closedCampaign('c2', [], 'mill', null, [], { ...saved, paidPick: 'mill' }).verdict).toBe('no_evidence');
  });
});
