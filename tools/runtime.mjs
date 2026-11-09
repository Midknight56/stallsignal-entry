import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const base = process.env.SS_BASE || 'http://127.0.0.1:8799';
export const launchOptions = {
  headless: true,
  ...(process.env.SS_BROWSER_CHANNEL ? { channel: process.env.SS_BROWSER_CHANNEL } : {}),
};
export const isMain = (url) =>
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(url);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function api(request, route, body) {
  const response =
    body === undefined
      ? await request.get(`${base}${route}`)
      : await request.post(`${base}${route}`, { data: body });
  if (!response.ok()) throw new Error(`${route}: HTTP ${response.status()}`);
  return response.json();
}

export async function waitCampaign(request, predicate, timeout = 120_000) {
  const end = Date.now() + timeout;
  do {
    const campaign = await api(request, '/api/campaign');
    if (predicate(campaign)) return campaign;
    await sleep(1000);
  } while (Date.now() < end);
  throw new Error('Campaign did not reach the required payment state before the timeout.');
}
