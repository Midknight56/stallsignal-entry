import snapshot from '../data/recorded-agent.json' with { type: 'json' };
import { CACHE_TTL_MS, MODEL_ENABLED } from '../caps';
import type { Database } from '../engine/store';
import type { AgentView } from '../shared/types';
import type { Evidence } from './facts';
import { appLeft } from './ledger';
import { hash, takeRun } from './limits';
import type { Model } from './model';
import { runToolLoop } from './loop';
import { codeAnswer, pickSchema } from './answer';
export { codeAnswer, pickSchema };
import { compare_sites } from './tools';

export interface RunDeps {
  db?: Database;
  ledger?: Database;
  model?: Model;
  visitor: string;
  now?: number;
}
export function recordedAnswer(): AgentView {
  return { ...(snapshot as AgentView), source: 'recorded' };
}
export function fallbackAnswer(
  input: Evidence,
  reason: NonNullable<AgentView['fallback']>,
  left = 0,
): AgentView {
  return {
    ...codeAnswer(input),
    source: 'code',
    fallback: reason,
    budgetCents: input.budget,
    steps: [],
    neurons: { reserved: 0, used: 0, appLeft: left },
  };
}
export async function cacheKey(input: Evidence) {
  const decision = compare_sites(input);
  // Order count also affects the blend; equal unit totals alone are insufficient.
  return hash(
    JSON.stringify({
      budget: input.budget,
      share: input.share ?? null,
      paid: decision.venues.map((v) => [v.id, v.paidUnits, v.recordedUnits]),
      recorded: input.recorded.length > 0,
      orders: input.preorders.filter((p) => p.source === 'live' && p.state === 'captured').length,
      recordedOrders: input.recorded.filter(
        (p) =>
          p.source === 'recorded' &&
          p.captureId &&
          p.captureId !== 'PENDING_RECORD' &&
          ['captured', 'refund_queued', 'refunding', 'refunded', 'refund_pending', 'refund_failed'].includes(
            p.state,
          ),
      ).length,
    }),
  );
}
export async function runAgent(input: Evidence, deps: RunDeps): Promise<AgentView> {
  const at = new Date(deps.now ?? Date.now()).toISOString();
  const day = at.slice(0, 10);
  try {
    if (!deps.db) return fallbackAnswer(input, 'model_off');
    const key = await cacheKey(input);
    const cached = await deps.db
      .prepare('SELECT body FROM agent_cache WHERE key=? AND expiresAt>?')
      .bind(key, at)
      .first<{ body: string }>();
    if (cached) {
      try {
        const answer = JSON.parse(cached.body) as AgentView & { loop?: number };
        if (answer.loop !== 1) delete answer.steps;
        delete answer.loop;
        return {
          ...answer,
          source: 'cache',
          budgetCents: answer.budgetCents ?? input.budget,
          neurons: { reserved: 0, used: 0, appLeft: await appLeft(deps.ledger, day) },
        };
      } catch {
        /* Recompute a corrupt cache entry. */
      }
    }
    if (!deps.ledger || !deps.model || !MODEL_ENABLED)
      return fallbackAnswer(input, 'model_off', await appLeft(deps.ledger, day));
    if (!(await takeRun(deps.db, deps.visitor, at, 'runs')))
      return fallbackAnswer(input, 'run_limit', await appLeft(deps.ledger, day));
    const result = await runToolLoop(input, deps);
    try {
      await deps.db
        .prepare(
          'INSERT INTO agent_cache(key,body,expiresAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expiresAt=excluded.expiresAt',
        )
        .bind(
          key,
          JSON.stringify({ ...result, loop: 1 }),
          new Date(Date.parse(at) + CACHE_TTL_MS).toISOString(),
        )
        .run();
    } catch {
      /* An answer remains usable without a cache write. */
    }
    return result;
  } catch {
    return fallbackAnswer(input, 'error');
  }
}
