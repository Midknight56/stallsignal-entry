import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { PreorderState } from '../../src/shared/types';
import Receipt from '../src/components/Receipt';
import Receipts from '../src/pages/Receipts';
import { receiptId, shortId } from '../src/format';
import { world } from '../src/mock/fixtures';

const paid = world.recorded!.preorders.find((p) => p.state === 'captured')!;
const closed = { state: 'closed' as const, chosen: paid.venue };

it('only waits for ids that can still arrive', () => {
  for (const state of ['declined', 'canceled', 'failed'] satisfies PreorderState[]) {
    const p = { ...paid, state, captureId: null, refundId: null };
    expect(receiptId(p, 'captureId', closed)).toBe('None');
    expect(receiptId(p, 'refundId', closed)).toBe('None');
    expect(receiptId(p, 'orderId', closed)).toBe(p.orderId);
  }
  expect(receiptId(paid, 'refundId', closed)).toBe('Not needed, venue chosen');
  expect(receiptId(paid, 'refundId', { ...closed, state: 'open' })).toBe('Not yet');
  expect(receiptId(paid, 'refundId', { ...closed, chosen: 'wharf' })).toBe('Not yet');
  for (const state of ['creating', 'checking', 'pending', 'capturing'] satisfies PreorderState[])
    expect(receiptId({ ...paid, state, captureId: null }, 'captureId')).toBe('Not yet');
  for (const state of [
    'refund_queued',
    'refunding',
    'refund_pending',
    'refund_failed',
  ] satisfies PreorderState[])
    expect(receiptId({ ...paid, state }, 'refundId', closed)).toBe('Not yet');
  expect(receiptId({ ...paid, refundId: 'REFUND' }, 'refundId', closed)).toBe('REFUND');
  expect(receiptId({ ...paid, state: 'refunded' }, 'refundId', closed)).toBe('None');
});

it('uses the same rule on receipt cards and the recorded Receipts page', () => {
  const card = renderToStaticMarkup(createElement(Receipt, { preorder: paid, campaign: closed }));
  const page = renderToStaticMarkup(createElement(Receipts, { world }));
  expect(card).toContain('Not needed, venue chosen');
  expect(page).toContain('Not needed, venue chosen');
  for (const state of ['declined', 'canceled', 'failed'] satisfies PreorderState[]) {
    const markup = renderToStaticMarkup(
      createElement(Receipt, {
        preorder: { ...paid, state, captureId: null },
        campaign: closed,
      }),
    );
    expect(markup).toContain('<dt>Capture id</dt><dd title="">None</dd>');
    expect(markup).toContain('<dt>Refund id</dt><dd title="">None</dd>');
  }
});

it('shortens preorder ids consistently', () => {
  expect(shortId('0472643feb964ea29303db0bb260f263')).toBe('0472643f…f263');
});

it('shows Card for a card receipt and PayPal for older recorded receipts', () => {
  const card = renderToStaticMarkup(createElement(Receipt, { preorder: { ...paid, method: 'card' } }));
  const legacy = renderToStaticMarkup(createElement(Receipt, { preorder: { ...paid, method: undefined } }));
  expect(card).toContain('<dt>Method</dt><dd>Card</dd>');
  expect(card).toContain('Paid');
  expect(card).toContain(paid.captureId!);
  expect(legacy).toContain('<dt>Method</dt><dd>PayPal</dd>');
});
