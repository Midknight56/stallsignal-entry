import recordedData from '../data/recorded.json' with { type: 'json' };
import { decide, evidenceCounts } from '../domain/blend';
import { closedCampaign, scorecard } from '../domain/scorecard';
import { DEFAULT_CONTEXT, shareOf, type DecisionContext } from '../domain/context';
import { HttpError } from '../errors';
import { LostResponse } from '../paypal/client';
import type { CampaignView, Op, Preorder, ScorecardCampaignRow, VenueId } from '../shared/types';
import { Preorders } from './preorders';
import { Store, publicPreorder, type CampaignRow } from './store';

export const recorded = recordedData as Omit<typeof recordedData, 'preorders'> & { preorders: Preorder[] };
export const recordedEvidence = () => (recorded.recordedAt ? recorded.preorders : []);
const liabilities = ['refund_queued', 'refunding', 'refund_pending', 'refund_failed'];
export class Campaigns {
  replayEvents: (id: string) => Promise<void> = async () => {};
  constructor(
    readonly store: Store,
    readonly preorders: Preorders,
  ) {
    preorders.onCaptured = (id) => this.afterCapture(id);
  }
  async view(id: string): Promise<CampaignView> {
    const campaign = (await this.store.campaign(id))!;
    const rows = await this.store.preorders(id);
    const ops = await this.store.all<Op>(
      'SELECT o.kind,o.requestId,o.status,o.http,o.paypalId,o.at FROM ops o JOIN preorders p ON p.id=o.preorderId WHERE p.campaignId=? ORDER BY o.at,o.requestId',
      id,
    );
    const uncertainRefunds = new Set(
      (
        await this.store.all<{ preorderId: string }>(
          "SELECT o.preorderId FROM ops o JOIN preorders p ON p.id=o.preorderId WHERE p.campaignId=? AND o.kind='refund' AND o.status='lost'",
          id,
        )
      ).map((o) => o.preorderId),
    );
    return {
      id,
      state: campaign.state,
      chosen: campaign.chosen,
      shareToken: campaign.shareToken ?? null,
      ...decide(rows, 90000, recordedEvidence()),
      ...evidenceCounts(rows, recordedEvidence()),
      preorders: rows.map(publicPreorder),
      liabilityCents: rows
        .filter(
          (p) => liabilities.includes(p.state) || (p.state === 'checking' && uncertainRefunds.has(p.id)),
        )
        .reduce((sum, p) => sum + p.amountCents, 0),
      checking: rows.some((p) => ['checking', 'capturing', 'creating'].includes(p.state)),
      ops,
    };
  }
  async afterCapture(id: string) {
    const row = (await this.store.preorder(id))!;
    const campaign = (await this.store.campaign(row.campaignId))!;
    if (campaign.state !== 'open' && campaign.chosen !== row.venue) {
      await this.store.transition(id, ['captured'], 'refund_queued');
      await this.refundQueue(campaign.id);
    }
  }
  async close(id: string, venue: VenueId, context: DecisionContext = DEFAULT_CONTEXT): Promise<CampaignView> {
    const token = crypto.randomUUID();
    if (
      !(await this.store.run(
        "UPDATE campaigns SET state='closing',chosen=?,close_token=? WHERE id=? AND state='open'",
        venue,
        token,
        id,
      ))
    )
      throw new HttpError(409, 'ALREADY_CLOSING', 'This campaign is already closing or closed.');
    await this.replayEvents(id);
    const rows = await this.store.preorders(id);
    for (const row of rows) {
      if (['checking', 'capturing', 'pending'].includes(row.state)) {
        try {
          await this.preorders.reconcile(row.id);
        } catch {
          /* Keep uncertain payments visible for the next reconcile. */
        }
      }
    }
    // Save the decision the maker saw, at their budget, evidence choice and share, before any refund changes it.
    const seen = decide(
      await this.store.preorders(id),
      context.budget,
      context.includeRecorded ? recordedEvidence() : [],
      shareOf(context.sharePercent),
    );
    await this.store.run(
      'UPDATE campaigns SET decisionBudget=?,decisionIncludeRecorded=?,decisionSharePercent=?,decisionForecastPick=?,decisionPaidPick=? WHERE id=?',
      context.budget,
      context.includeRecorded ? 1 : 0,
      context.sharePercent,
      seen.forecastPick,
      seen.decided,
      id,
    );
    await this.store.run(
      "UPDATE preorders SET state='canceled',updatedAt=? WHERE campaignId=? AND venue<>? AND state IN ('created','approved')",
      this.store.now(),
      id,
      venue,
    );
    await this.store.run(
      "UPDATE preorders SET state='refund_queued',updatedAt=? WHERE campaignId=? AND venue<>? AND state='captured'",
      this.store.now(),
      id,
      venue,
    );
    await this.refundQueue(id);
    await this.store.run(
      "UPDATE campaigns SET state='closed',closedAt=? WHERE id=? AND state='closing' AND close_token=?",
      this.store.now(),
      id,
      token,
    );
    return this.view(id);
  }
  async refundQueue(campaignId: string) {
    const token = crypto.randomUUID();
    if (
      !(await this.store.run(
        'UPDATE campaigns SET refund_token=? WHERE id=? AND refund_token IS NULL',
        token,
        campaignId,
      ))
    )
      return;
    try {
      while (true) {
        const row = await this.store.first<{ id: string }>(
          "SELECT id FROM preorders WHERE campaignId=? AND state='refund_queued' ORDER BY createdAt,id LIMIT 1",
          campaignId,
        );
        if (!row) break;
        await this.refund(row.id);
      }
    } finally {
      await this.store.run(
        'UPDATE campaigns SET refund_token=NULL WHERE id=? AND refund_token=?',
        campaignId,
        token,
      );
    }
    if (
      await this.store.first(
        "SELECT id FROM preorders WHERE campaignId=? AND state='refund_queued' LIMIT 1",
        campaignId,
      )
    )
      await this.refundQueue(campaignId);
  }
  private async refund(id: string) {
    const row = (await this.store.preorder(id))!;
    if (!row.captureId || !(await this.store.transition(id, ['refund_queued'], 'refunding'))) return;
    const requestId = await this.store.beginOp('refund', id);
    try {
      const result = await this.preorders.pp.refundCapture(
        row.captureId,
        {
          custom_id: `ss-${row.campaignId}-${id}-r`,
          note_to_payer: 'This venue was not chosen. Your preorder is fully refunded.',
        },
        requestId,
      );
      await this.store.finishOp(
        requestId,
        result.ok ? 'ok' : 'failed',
        result.status,
        result.body.id ?? null,
      );
      if (result.body.simulated) await this.store.run('UPDATE preorders SET simulated=1 WHERE id=?', id);
      if (!result.ok) {
        await this.store.transition(id, ['refunding'], 'refund_failed', { debugId: result.debugId });
        return;
      }
      if (!result.body.id || !result.body.status) throw new LostResponse();
      await this.preorders.applyRefund(id, result.body, result.debugId);
      // Read every successful refund back. A simulated pending result stays visible until explicit reconciliation.
      const read = await this.preorders.pp.getRefund(result.body.id);
      if (read.ok && !result.body.simulated) await this.preorders.applyRefund(id, read.body, read.debugId);
    } catch (error) {
      const current = (await this.store.preorder(id))!;
      if (current.refundId) return;
      await this.preorders.writeError(id, 'refund', requestId, error);
    }
  }
  async retry(id: string) {
    const row = (await this.store.preorder(id))!;
    const campaign = (await this.store.campaign(row.campaignId))!;
    if (campaign.state === 'open' || campaign.chosen === row.venue)
      throw new HttpError(409, 'REFUND_NOT_DUE', 'This payment is not due a refund.');
    if (row.refundId) await this.preorders.reconcile(id);
    await this.store.transition(id, ['refund_failed'], 'refund_queued');
    await this.refundQueue(row.campaignId);
    return this.view(row.campaignId);
  }
  async reset(campaign: CampaignRow) {
    if (campaign.state !== 'closed')
      throw new HttpError(409, 'CAMPAIGN_OPEN', 'Close this campaign before starting another.');
    const id = crypto.randomUUID().replaceAll('-', '');
    await this.store.run(
      "INSERT OR IGNORE INTO campaigns(id,sessionId,state,createdAt) VALUES(?,?,'open',?)",
      id,
      campaign.sessionId,
      this.store.now(),
    );
    const current = (await this.store.first<CampaignRow>(
      'SELECT * FROM campaigns WHERE sessionId=? ORDER BY rowid DESC LIMIT 1',
      campaign.sessionId,
    ))!;
    return this.view(current.id);
  }
  async scorecard() {
    const campaigns = await this.store.all<CampaignRow>(
      "SELECT * FROM campaigns WHERE state='closed' ORDER BY closedAt",
    );
    const rows: ScorecardCampaignRow[] = [];
    for (const campaign of campaigns) {
      const preorders = await this.store.preorders(campaign.id);
      rows.push(closedCampaign(campaign.id, preorders, campaign.chosen!, campaign.closedAt));
    }
    return scorecard(rows);
  }
}
