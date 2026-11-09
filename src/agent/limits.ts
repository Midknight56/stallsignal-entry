import { MAX_ASKS_PER_VISITOR_PER_DAY, MAX_RUNS_PER_DAY, MAX_RUNS_PER_VISITOR_PER_DAY } from '../caps';
import type { Database } from '../engine/store';
export async function hash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function visitorId(request: Request) {
  return hash(
    JSON.stringify([
      request.headers.get('cf-connecting-ip') ?? 'local',
      request.headers.get('user-agent') ?? '',
    ]),
  );
}
export async function takeRun(
  db: Database,
  visitor: string,
  at: string,
  kind: 'runs' | 'asks',
): Promise<boolean> {
  const day = at.slice(0, 10);
  try {
    const result = await db
      .prepare(
        `INSERT INTO ${kind}(day,visitor,at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM ${kind} WHERE day=? AND visitor=?) < ?` +
          (kind === 'runs' ? ' AND (SELECT COUNT(*) FROM runs WHERE day=?) < ?' : ''),
      )
      .bind(
        day,
        visitor,
        at,
        day,
        visitor,
        kind === 'runs' ? MAX_RUNS_PER_VISITOR_PER_DAY : MAX_ASKS_PER_VISITOR_PER_DAY,
        ...(kind === 'runs' ? [day, MAX_RUNS_PER_DAY] : []),
      )
      .run();
    return result.meta.changes > 0;
  } catch {
    return false;
  }
}
