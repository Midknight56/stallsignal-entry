import { PREORDER_SHARE } from '../data/history';
import {
  DEFAULT_STOCK_BUDGET_CENTS,
  MAX_STOCK_BUDGET_CENTS,
  MIN_STOCK_BUDGET_CENTS,
  STOCK_BUDGET_STEP_CENTS,
} from '../caps';
import type { Preorder } from '../shared/types';

// The one set of choices behind every decision on screen: the stock budget, whether the recorded example counts,
// and the assumed preorder share. Map, panel, agent, campaign close and scorecard all read the same three values.
export interface DecisionContext {
  budget: number;
  includeRecorded: boolean;
  sharePercent: number;
}
export const HISTORY_SHARE_PERCENT = Math.round(PREORDER_SHARE * 100);
export const SHARE_CHOICES = [...new Set([10, HISTORY_SHARE_PERCENT, 20, 30])].sort((a, z) => a - z);
export const DEFAULT_CONTEXT: DecisionContext = {
  budget: DEFAULT_STOCK_BUDGET_CENTS,
  includeRecorded: true,
  sharePercent: HISTORY_SHARE_PERCENT,
};
// The history choice uses the exact history share, so the default matches the decision the server always made.
export const shareOf = (sharePercent: number) =>
  sharePercent === HISTORY_SHARE_PERCENT ? PREORDER_SHARE : sharePercent / 100;

export const validBudget = (b: unknown): b is number =>
  typeof b === 'number' &&
  Number.isInteger(b) &&
  b >= MIN_STOCK_BUDGET_CENTS &&
  b <= MAX_STOCK_BUDGET_CENTS &&
  (b - MIN_STOCK_BUDGET_CENTS) % STOCK_BUDGET_STEP_CENTS === 0;

// Missing fields take the default. A value the screen does not offer returns null.
export function parseContext(body: unknown): DecisionContext | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const budget = b.budget ?? DEFAULT_CONTEXT.budget;
  const includeRecorded = b.includeRecorded ?? DEFAULT_CONTEXT.includeRecorded;
  const sharePercent = b.sharePercent ?? DEFAULT_CONTEXT.sharePercent;
  if (!validBudget(budget)) return null;
  if (typeof includeRecorded !== 'boolean') return null;
  if (typeof sharePercent !== 'number' || !SHARE_CHOICES.includes(sharePercent)) return null;
  return { budget, includeRecorded, sharePercent };
}

// What the agent reads: this campaign's payments, the recorded example only when it is included, and the share.
export function evidenceFor(context: DecisionContext, preorders: Preorder[], recorded: Preorder[]) {
  return {
    budget: context.budget,
    preorders,
    recorded: context.includeRecorded ? recorded : [],
    share: shareOf(context.sharePercent),
  };
}

const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    cents / 100,
  );
export function contextLabel(c: DecisionContext) {
  return `${dollars(c.budget)}, ${c.includeRecorded ? 'recorded example included' : 'this campaign only'}, ${c.sharePercent}% preorder share`;
}
