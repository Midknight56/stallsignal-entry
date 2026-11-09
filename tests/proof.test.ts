import { describe, expect, it } from 'vitest';
import {
  runAllProofs,
  runClientAmountIgnoredScenario,
  runConcurrentCloseScenario,
  runDuplicateWebhookScenario,
  runLateCaptureCloseScenario,
  runLateWebhookScenario,
  runLostCaptureScenario,
} from '../src/proof/runner';

describe('browser proof scenarios in node', () => {
  it('A lost capture answer is read back from PayPal and settles to one capture, never two.', async () => {
    const result = await runLostCaptureScenario();
    expect(result.status).toBe('Held');
    expect(result.requestId).toBeTruthy();
    expect(result.orderId).toBeTruthy();
  });

  it('Two closes at the same moment run once.', async () => {
    const result = await runConcurrentCloseScenario();
    expect(result.status).toBe('Held');
    expect(result.requestId).toBeTruthy();
    expect(result.orderId).toBeTruthy();
    expect(result.refundId).toBeTruthy();
  });

  it('A capture that lands while the campaign closes is refunded if its venue lost.', async () => {
    const result = await runLateCaptureCloseScenario();
    expect(result.status).toBe('Held');
    expect(result.requestId).toBeTruthy();
    expect(result.orderId).toBeTruthy();
    expect(result.refundId).toBeTruthy();
  });

  it('A client that sends its own amount is ignored; the catalog price is used.', async () => {
    const result = await runClientAmountIgnoredScenario();
    expect(result.status).toBe('Held');
    expect(result.requestId).toBeTruthy();
    expect(result.orderId).toBeTruthy();
    expect(result.summary).toBe(
      'The app ignored the amount sent by the browser and used the catalog price of $56.00.',
    );
  });

  it('A repeated webhook event changes nothing the second time.', async () => {
    const result = await runDuplicateWebhookScenario();
    expect(result.status).toBe('Held');
    expect(result.requestId).toBeTruthy();
    expect(result.orderId).toBeTruthy();
  });

  it('A late webhook never moves a refunded payment back to captured.', async () => {
    const result = await runLateWebhookScenario();
    expect(result.status).toBe('Held');
    expect(result.requestId).toBeTruthy();
    expect(result.orderId).toBeTruthy();
    expect(result.refundId).toBeTruthy();
  });

  it('all six scenarios run together cleanly', async () => {
    const results = await runAllProofs();
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.status).toBe('Held');
      for (const id of [r.requestId, r.orderId, r.captureId, r.refundId]) {
        if (id) expect(r.summary).not.toContain(id);
      }
      expect(r.summary).not.toMatch(/cents|venue wharf/);
    }
  });
});
