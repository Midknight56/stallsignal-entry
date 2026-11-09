import { chromium } from '@playwright/test';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { approve } from './buyer.mjs';
import { api, base, isMain, launchOptions, root, waitCampaign } from './runtime.mjs';

const fields = [
  'id',
  'venue',
  'product',
  'qty',
  'amountCents',
  'state',
  'orderId',
  'captureId',
  'refundId',
  'debugId',
  'updatedAt',
];
export const receipt = (p) => Object.fromEntries(fields.map((key) => [key, p[key] ?? null]));
const operation = (o) =>
  Object.fromEntries(
    ['kind', 'requestId', 'status', 'http', 'paypalId', 'at'].map((key) => [key, o[key] ?? null]),
  );
const agentFields = ['pick', 'codePick', 'source', 'risk', 'stockCostCents'];
export function recordedAgent(answer, capturedAt) {
  return {
    ...Object.fromEntries(agentFields.map((key) => [key, answer[key]])),
    ...(answer.source === 'ai'
      ? { label: 'Recorded run, captured ' + capturedAt, kind: 'model answer' }
      : {}),
    capturedAt,
    facts: answer.facts.map((f) => ({ id: f.id, text: f.text })),
    allocation: answer.allocation.map((a) => ({
      product: a.product,
      units: a.units,
      costCents: a.costCents,
    })),
    offer: { venue: answer.offer.venue, lines: answer.offer.lines, terms: answer.offer.terms },
    neurons: {
      reserved: answer.neurons.reserved,
      used: answer.neurons.used,
      appLeft: answer.neurons.appLeft,
    },
  };
}
async function atomic(file, value) {
  await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

export async function recordRun() {
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext();
  const page = await context.newPage();
  const timeline = new Map();
  const observed = (view) => {
    for (const p of view.preorders) {
      const rows = timeline.get(p.id) || [];
      const item = receipt(p);
      if (JSON.stringify(rows.at(-1)?.receipt) !== JSON.stringify(item))
        rows.push({ observedAt: new Date().toISOString(), receipt: item });
      timeline.set(p.id, rows);
    }
  };
  const out = path.join(root, 'tools/out');
  await mkdir(out, { recursive: true });
  try {
    await api(context.request, '/health');
    const initial = await api(context.request, '/api/campaign');
    if (initial.state !== 'open' || initial.preorders.length)
      throw new Error('Recording requires a new empty campaign.');
    const mix = [
      ['mill', 'tin', 2],
      ['mill', 'jar', 2],
      ['mill', 'tin', 1],
      ['mill', 'jar', 1],
      ['mill', 'trio', 1],
      ['mill', 'tin', 1],
      ['wharf', 'jar', 1],
      ['wharf', 'tin', 1],
      ['linden', 'trio', 1],
    ];
    for (const [venue, product, qty] of mix) {
      const created = await api(context.request, '/api/preorders', { venue, product, qty });
      observed({ preorders: [created.preorder] });
      await approve(page, created.approveUrl);
      const paid = await waitCampaign(
        context.request,
        (c) => c.preorders.find((p) => p.id === created.preorder.id)?.state === 'captured',
      );
      observed(paid);
      await atomic(path.join(out, 'record-progress.json'), {
        campaignId: paid.id,
        preorders: paid.preorders.map(receipt),
        timeline: Object.fromEntries(timeline),
        ops: paid.ops.map(operation),
      });
      console.log(`Captured preorder ${paid.preorders.length}/9.`);
    }
    // Ask at the default budget while all nine paid preorders still count as live demand.
    const answer = await api(context.request, '/api/agent', { budget: 90000 });
    const closed = await api(context.request, '/api/campaign/close', { venue: 'mill' });
    observed(closed);
    const settled = await waitCampaign(
      context.request,
      (c) =>
        c.state === 'closed' &&
        c.preorders.every((p) =>
          p.venue === 'mill' ? p.state === 'captured' : ['refunded', 'refund_pending'].includes(p.state),
        ),
    );
    observed(settled);
    if (settled.preorders.some((p) => !p.orderId || !p.captureId || (p.venue !== 'mill' && !p.refundId)))
      throw new Error('The recorded campaign is missing a payment or refund id.');
    const recordedAt = new Date().toISOString();
    await atomic(path.join(root, 'src/data/recorded.json'), {
      id: 'rec-1',
      campaignId: settled.id,
      recordedAt,
      label: 'Recorded sandbox run',
      chosen: 'mill',
      state: settled.state,
      preorders: settled.preorders.map((p) => ({
        ...receipt(p),
        source: 'recorded',
        timeline: timeline.get(p.id),
      })),
      ops: settled.ops.map(operation),
    });
    if (answer.source === 'ai') {
      await atomic(path.join(root, 'src/data/recorded-agent.json'), recordedAgent(answer, recordedAt));
      console.log('Saved the live agent answer at the default budget.');
    } else console.log(`Agent source was ${answer.source}; recorded-agent.json was left unchanged.`);
    console.log('Saved nine real sandbox receipts; losing payments are refunded or refund pending.');
  } catch (error) {
    console.error(
      'Recording stopped. Existing payments were not replaced; sanitized partial receipts are in tools/out/record-progress.json when available.',
    );
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

if (isMain(import.meta.url)) {
  try {
    await recordRun();
  } catch (error) {
    console.error(/^browserType\./.test(error.message) ? 'Headless browser could not start.' : error.message);
    process.exitCode = 1;
  }
}
