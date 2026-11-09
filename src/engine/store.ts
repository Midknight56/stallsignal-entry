import type { CampaignView, Op, Preorder, VenueId } from '../shared/types';

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number; last_row_id?: number } }>;
}
export interface Database {
  prepare(sql: string): SqlStatement;
}
export interface CampaignRow {
  id: string;
  sessionId: string;
  state: CampaignView['state'];
  chosen: VenueId | null;
  close_token: string | null;
  createdAt: string;
  closedAt: string | null;
  shareToken?: string | null;
  decisionBudget?: number | null;
  decisionIncludeRecorded?: number | null;
  decisionSharePercent?: number | null;
  decisionForecastPick?: VenueId | null;
  decisionPaidPick?: VenueId | null;
}
export interface PreorderRow extends Preorder {
  method: NonNullable<Preorder['method']>;
  campaignId: string;
  createdAt: string;
  approveUrl: string | null;
  simulated: number;
  buyerSessionId?: string | null;
}
export interface OpRow extends Op {
  preorderId: string;
  retryCount: number;
  body: string | null;
}
export interface EventRow {
  event_id: string;
  type: string;
  resourceId: string;
  customId: string;
  campaignId: string | null;
  status: string;
  at: string;
}

export class Store {
  constructor(
    readonly db: Database,
    readonly clock: () => number = Date.now,
  ) {}
  now() {
    return new Date(this.clock()).toISOString();
  }
  first<T>(sql: string, ...args: unknown[]) {
    return this.db
      .prepare(sql)
      .bind(...args)
      .first<T>();
  }
  async all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    return (
      await this.db
        .prepare(sql)
        .bind(...args)
        .all<T>()
    ).results;
  }
  async run(sql: string, ...args: unknown[]): Promise<number> {
    return (
      await this.db
        .prepare(sql)
        .bind(...args)
        .run()
    ).meta.changes;
  }
  campaign(id: string) {
    return this.first<CampaignRow>('SELECT * FROM campaigns WHERE id=?', id);
  }
  preorder(id: string) {
    return this.first<PreorderRow>('SELECT * FROM preorders WHERE id=?', id);
  }
  preorders(campaignId: string) {
    return this.all<PreorderRow>(
      'SELECT * FROM preorders WHERE campaignId=? ORDER BY createdAt,id',
      campaignId,
    );
  }
  op(kind: string, id: string) {
    return this.first<OpRow>('SELECT * FROM ops WHERE requestId=?', `ss-${kind}-${id}`);
  }
  async beginOp(kind: Op['kind'], id: string, body: object | null = null) {
    const requestId = `ss-${kind}-${id}`;
    await this.run(
      "INSERT INTO ops(requestId,preorderId,kind,status,at,body) VALUES(?,?,?,'sending',?,?) ON CONFLICT(requestId) DO UPDATE SET status=CASE WHEN ops.status='lost' THEN 'lost' ELSE 'sending' END",
      requestId,
      id,
      kind,
      this.now(),
      body ? JSON.stringify(body) : null,
    );
    return requestId;
  }
  async finishOp(requestId: string, status: Op['status'], http: number | null, paypalId: string | null) {
    await this.run(
      'UPDATE ops SET status=?,http=?,paypalId=? WHERE requestId=?',
      status,
      http,
      paypalId,
      requestId,
    );
  }
  async resolveLostOp(kind: Op['kind'], id: string, paypalId: string) {
    await this.run(
      "UPDATE ops SET status='ok',http=NULL,paypalId=? WHERE requestId=? AND status='lost'",
      paypalId,
      `ss-${kind}-${id}`,
    );
  }
  async transition(
    id: string,
    from: string[],
    to: string,
    patch: Partial<
      Pick<PreorderRow, 'orderId' | 'captureId' | 'refundId' | 'debugId' | 'approveUrl' | 'simulated'>
    > = {},
  ) {
    const entries = Object.entries(patch);
    return this.run(
      `UPDATE preorders SET state=?,updatedAt=?${entries.map(([key]) => `,${key}=?`).join('')} WHERE id=? AND state IN (${from.map(() => '?').join(',')})`,
      to,
      this.now(),
      ...entries.map(([, value]) => value),
      id,
      ...from,
    );
  }
}
export function publicPreorder(row: PreorderRow): Preorder & { label?: string } {
  const {
    id,
    venue,
    product,
    qty,
    amountCents,
    state,
    orderId,
    captureId,
    refundId,
    debugId,
    updatedAt,
    source,
  } = row;
  return {
    id,
    method: row.method ?? 'paypal',
    venue,
    product,
    qty,
    amountCents,
    state,
    orderId,
    captureId,
    refundId,
    debugId,
    updatedAt,
    source,
    from: row.buyerSessionId ? 'buyer' : 'maker',
    ...(row.simulated ? { label: 'Simulated failure (dev route)' } : {}),
  };
}
