import { test as runner, expect, type BrowserContext, type TestInfo } from '@playwright/test';
import { unlink } from 'node:fs/promises';

const traces = new WeakMap<BrowserContext, { active: boolean; files: string[]; info: TestInfo }>();
export async function pauseForBuyer(context: BrowserContext) {
  const state = traces.get(context);
  if (!state?.active) return;
  const file = state.info.outputPath(`app-before-paypal-${state.files.length + 1}.zip`);
  await context.tracing.stop({ path: file });
  state.files.push(file);
  state.active = false;
}
export async function resumeAfterBuyer(context: BrowserContext) {
  const state = traces.get(context);
  if (!state || state.active) return;
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  state.active = true;
}

// The runner also records action arguments in test.trace, even when context tracing stops.
// Payment tests therefore manage app-only traces and disable the runner's automatic trace.
export const test = runner.extend<{ paymentTrace: void }>({
  paymentTrace: [
    async ({ context, page }, use, info) => {
      const state = { active: true, files: [] as string[], info };
      traces.set(context, state);
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      try {
        await use();
      } finally {
        const failed = info.status !== info.expectedStatus;
        if (state.active) {
          const file = info.outputPath('app-after-paypal.zip');
          await context.tracing.stop(failed ? { path: file } : {});
          if (failed) state.files.push(file);
        }
        // Automatic failure context must never snapshot a signed-in PayPal page.
        if (new URL(page.url()).origin !== new URL(process.env.SS_BASE || 'http://127.0.0.1:8799').origin)
          await page.goto('about:blank').catch(() => {});
        for (const file of state.files) {
          if (failed) await info.attach('app trace', { path: file, contentType: 'application/zip' });
          else await unlink(file);
        }
        traces.delete(context);
      }
    },
    { auto: true },
  ],
});
export { expect };
