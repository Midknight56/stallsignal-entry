import type { AgentView } from '../../src/shared/types';
import type { DecisionContext } from '../../src/domain/context';

// An agent answer belongs to the budget, evidence choice, share and payments it was asked with. When any of them
// changes, the answer no longer matches the screen and is not shown.
export const contextKey = (c: DecisionContext, evidenceKey: string | number = '') =>
  `${c.budget}|${c.includeRecorded ? 1 : 0}|${c.sharePercent}|${evidenceKey}`;

export type StoredAnswer = { key: string; answer: AgentView };

export const currentAnswer = (stored: StoredAnswer | null, key: string) =>
  stored && stored.key === key ? stored.answer : null;
