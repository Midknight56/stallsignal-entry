// $0: 900 <= 9000 <= 10000 free account neurons per UTC day.
export const APP_NEURONS_PER_DAY = 900;
// $0: account reservation ceiling leaves 1000 of the 10000 free neurons unused.
export const ACCOUNT_NEURONS_PER_DAY = 9000;
// $0: (4000*1542 + 512*10158)/1e6 = 11.368896 < 15 reserved neurons.
export const RESERVE_PER_CALL = 15;
export const MAX_TURNS = 4;
export const MODEL_ID = '@cf/ibm-granite/granite-4.0-h-micro';
export const DEPRECATED_MODELS: readonly string[] = [
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/qwen/qwen3-30b-a3b-fp8',
];
export function modelAllowed(model: string = MODEL_ID) {
  return !DEPRECATED_MODELS.includes(model);
}
// Evaluate at Worker startup. Routes keep their offline answers when this is false.
export const MODEL_ENABLED = modelAllowed();
// $0: 2400 input characters plus a 64 token template and 160 output tokens stay inside that reservation.
export const MAX_INPUT_CHARS = 2400;
// $0: (3464*1542 + 160*10158)/1e6 = 6.967968 < 15 reserved neurons.
// Count every serialized input character as a token, plus the 64 token template.
export const MAX_TURN_INPUT_CHARS = 3400;
export const TEMPLATE_TOKENS = 64;
export const MAX_OUTPUT_TOKENS = 160;
export const MAX_FACTS = 16;
export const MAX_ASK_CHARS = 200;
// $0: visitor and app count limits are additional gates; neuron limits still apply to every call.
export const MAX_RUNS_PER_VISITOR_PER_DAY = 12;
export const MAX_ASKS_PER_VISITOR_PER_DAY = 12;
export const MAX_RUNS_PER_DAY = 200;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_PREORDERS_PER_SESSION_PER_DAY = 10;
export const MAX_PREORDERS_PER_DAY = 400;
export const DEFAULT_STOCK_BUDGET_CENTS = 90000;
export const MIN_STOCK_BUDGET_CENTS = 15000;
export const MAX_STOCK_BUDGET_CENTS = 150000;
export const STOCK_BUDGET_STEP_CENTS = 5000;
export const CAPTURE_RETRY_WINDOW_MS = 60 * 60 * 1000;
export const MAX_CAPTURE_RETRIES = 1;

// A single shared ledger statement gates both sums before any resource can be consumed.
export async function reserveNeurons(
  ledger: import('./engine/store').Database,
  day: string,
  at = new Date().toISOString(),
): Promise<number | null> {
  try {
    const result = await ledger
      .prepare(
        'INSERT INTO ai_calls(app,day,neurons,at) SELECT ?,?,?,? WHERE ' +
          '(SELECT COALESCE(SUM(neurons),0) FROM ai_calls WHERE app=? AND day=?) + ? <= ? AND ' +
          '(SELECT COALESCE(SUM(neurons),0) FROM ai_calls WHERE day=?) + ? <= ?',
      )
      .bind(
        'stallsignal',
        day,
        RESERVE_PER_CALL,
        at,
        'stallsignal',
        day,
        RESERVE_PER_CALL,
        APP_NEURONS_PER_DAY,
        day,
        RESERVE_PER_CALL,
        ACCOUNT_NEURONS_PER_DAY,
      )
      .run();
    return result.meta.changes ? (result.meta.last_row_id ?? null) : null;
  } catch {
    return null;
  }
}
export async function settleNeurons(
  ledger: import('./engine/store').Database,
  id: number,
  measured: number | null,
) {
  if (measured === null || !Number.isFinite(measured) || measured < 0) return;
  try {
    await ledger
      .prepare('UPDATE ai_calls SET neurons=? WHERE id=? AND app=?')
      .bind(measured, id, 'stallsignal')
      .run();
  } catch {
    /* Retain the reservation. */
  }
}
