import { APP_NEURONS_PER_DAY, reserveNeurons, settleNeurons } from '../caps';
import type { Database } from '../engine/store';
export const reserve = reserveNeurons;
export const settle = settleNeurons;
export function keep(_id: number): void {
  /* Unknown outcomes retain the original reservation. */
}
export async function appLeft(ledger: Database | undefined, day: string): Promise<number> {
  try {
    if (!ledger) return 0;
    const row = await ledger
      .prepare('SELECT COALESCE(SUM(neurons),0) AS n FROM ai_calls WHERE app=? AND day=?')
      .bind('stallsignal', day)
      .first<{ n: number }>();
    return Math.max(0, APP_NEURONS_PER_DAY - (row?.n ?? 0));
  } catch {
    return 0;
  }
}
