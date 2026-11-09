import { closedCampaign, scorecard } from './domain/scorecard';
import { askStudio } from './agent/ask';
import { visitorId } from './agent/limits';
import { fallbackAnswer, recordedAnswer, runAgent } from './agent/run';
import { appLeft } from './agent/ledger';
import {
  DEFAULT_STOCK_BUDGET_CENTS,
  MIN_STOCK_BUDGET_CENTS,
  MAX_STOCK_BUDGET_CENTS,
  STOCK_BUDGET_STEP_CENTS,
  MAX_ASK_CHARS,
  MODEL_ENABLED,
  RESERVE_PER_CALL,
} from './caps';
import { catalog } from './data/catalog';
import { city } from './data/city';
import { heat } from './data/heat';
import { history, PREORDER_SHARE } from './data/history';
import { venues } from './data/venues';
import { forecastUnits } from './domain/forecast';
import { DEFAULT_CONTEXT, evidenceFor, parseContext, validBudget } from './domain/context';
import { Campaigns, recorded, recordedEvidence } from './engine/campaign';
import { Preorders } from './engine/preorders';
import { Store, publicPreorder, type Database, type CampaignRow } from './engine/store';
import { Webhooks } from './engine/webhooks';
import { HttpError } from './errors';
import { PayPal, type Fetch, type Fault, type WriteKind, type PayPalEnv } from './paypal/client';
import { currentCampaign, ownCampaign, ownPreorder, ownPreorderOrBuyer, session } from './session';
import type { VenueId, World } from './shared/types';

export type Env = Partial<Omit<WorkerBindings, 'DB' | 'ASSETS'>> &
  Partial<PayPalEnv> & {
    ASSETS: Pick<WorkerBindings['ASSETS'], 'fetch'>;
    DB?: Database;
  };
async function readBody(request: Request, max = 16384): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > max) {
        await reader.cancel();
        throw new HttpError(413, 'BODY_TOO_LARGE', 'The request is too large.');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await readBody(request);
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'INVALID_JSON', 'Send a JSON object.');
  }
}
function venueId(value: unknown): VenueId {
  if (!venues.some((v) => v.id === value))
    throw new HttpError(400, 'INVALID_VENUE', 'Choose an available venue.');
  return value as VenueId;
}
export const world: World = {
  city,
  venues,
  catalog,
  heat,
  history,
  recorded: {
    ...recorded,
    label: recorded.recordedAt ? 'Recorded run' : 'Recorded run not captured yet',
  },
  preorderShare: PREORDER_SHARE,
  modes: [
    'Real streets',
    'Example venues',
    'Synthetic history',
    'Live sandbox',
    recorded.recordedAt ? 'Recorded sandbox run' : 'Recorded run not captured yet',
    'Sandbox',
  ],
};

export function createWorker(options: { fetcher?: Fetch; clock?: () => number } = {}) {
  return {
    async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      let cookie: string | null = null;
      const respond = (body: unknown, status = 200) =>
        Response.json(body, {
          status,
          headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
        });
      try {
        if (request.method === 'GET' && path === '/health') return respond({ ok: true });
        if (request.method === 'GET' && path === '/api/agent/recorded') {
          return respond({ ...recordedAnswer(), budgetCents: 90000 });
        }
        if (request.method === 'GET' && path === '/api/world') {
          const day = new Date(options.clock?.() ?? Date.now()).toISOString().slice(0, 10);
          return respond({
            ...world,
            agent: {
              available:
                Boolean(env.AI && MODEL_ENABLED) && (await appLeft(env.LEDGER, day)) >= RESERVE_PER_CALL,
            },
          });
        }
        if (!path.startsWith('/api/') && path !== '/webhooks/paypal') return env.ASSETS.fetch(request);
        if (path === '/api/dev/fault' && env.DEV_ROUTES !== '1')
          throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
        if (request.method === 'POST' && path.startsWith('/api/')) {
          const origin = request.headers.get('origin');
          if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site')
            throw new HttpError(403, 'INVALID_ORIGIN', 'Use this site to change your campaign.');
        }
        if (['/api/agent', '/api/ask'].includes(path) && request.method === 'POST') {
          const body = await jsonBody(request);
          const deps = {
            db: env.DB,
            ledger: env.LEDGER,
            model: env.AI,
            visitor: await visitorId(request),
            now: options.clock?.(),
          };
          if (path === '/api/ask') {
            if (typeof body.q !== 'string' || !body.q.trim() || body.q.length > MAX_ASK_CHARS)
              throw new HttpError(400, 'INVALID_QUESTION', 'Ask a question of up to 200 characters.');
            return respond(await askStudio(body.q, deps));
          }
          if (!validBudget(body.budget ?? DEFAULT_STOCK_BUDGET_CENTS))
            throw new HttpError(
              400,
              'INVALID_BUDGET',
              'Choose a stock budget from $150 to $1500 in $50 steps.',
            );
          const context = parseContext(body);
          if (!context)
            throw new HttpError(400, 'INVALID_CONTEXT', 'Choose the evidence and preorder share from the screen.');
          if (!env.DB) return respond(fallbackAnswer(evidenceFor(context, [], recordedEvidence()), 'model_off'));
          try {
            const store = new Store(env.DB, options.clock);
            const current = await session(request, store);
            cookie = current.cookie;
            const campaign = await currentCampaign(store, current.id);
            return respond(
              await runAgent(evidenceFor(context, await store.preorders(campaign.id), recordedEvidence()), deps),
            );
          } catch {
            return respond(fallbackAnswer(evidenceFor(context, [], recordedEvidence()), 'error'));
          }
        }
        if (!env.DB) throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'Campaign storage is unavailable.');
        const store = new Store(env.DB, options.clock);
        let sid = '';
        if (path !== '/webhooks/paypal' && path !== '/api/scorecard') {
          const current = await session(request, store);
          sid = current.id;
          cookie = current.cookie;
        }
        const takeFault = async (kind: WriteKind): Promise<Fault | null> => {
          if (!sid) return null;
          const key = `fault:${sid}`;
          const row = await store.first<{ day: Fault; used: number }>(
            'SELECT day,used FROM caps WHERE key=?',
            key,
          );
          if (
            !row?.used ||
            ((row.day !== 'lose_next_response' || kind === 'card') &&
              !(
                (kind === 'card' && row.day === 'decline_next_card') ||
                (kind === 'capture' && ['capture_pending', 'decline_next_capture'].includes(row.day)) ||
                (kind === 'refund' && ['refund_pending', 'refund_fails'].includes(row.day))
              ))
          )
            return null;
          return (await store.run('UPDATE caps SET used=0 WHERE key=? AND used=1 AND day=?', key, row.day))
            ? row.day
            : null;
        };
        const pp = new PayPal(
          {
            PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID ?? '',
            PAYPAL_SECRET: env.PAYPAL_SECRET ?? '',
            PAYPAL_WEBHOOK_ID: env.PAYPAL_WEBHOOK_ID ?? '',
            PAYPAL_BASE: env.PAYPAL_BASE,
            DEV_ROUTES: env.DEV_ROUTES,
          },
          options.fetcher,
          options.clock,
          takeFault,
        );
        const preorders = new Preorders(store, pp);
        const campaigns = new Campaigns(store, preorders);
        const webhooks = new Webhooks(store, pp, preorders);
        campaigns.replayEvents = (id) => webhooks.replay(id);
        if (request.method === 'POST' && path === '/webhooks/paypal') {
          await webhooks.receive(request.headers, await readBody(request, 262144));
          return respond({ ok: true });
        }
        if (request.method === 'GET' && path === '/api/scorecard') {
          const closed = await store.all<CampaignRow & { chosen: VenueId }>(
            "SELECT id,chosen,closedAt,decisionBudget,decisionIncludeRecorded,decisionSharePercent,decisionForecastPick,decisionPaidPick FROM campaigns WHERE state='closed' ORDER BY closedAt",
          );
          const rows = [];
          for (const campaign of closed) {
            rows.push(
              closedCampaign(
                campaign.id,
                await store.preorders(campaign.id),
                campaign.chosen,
                campaign.closedAt,
                [],
                campaign.decisionBudget && campaign.decisionForecastPick && campaign.decisionPaidPick
                  ? {
                      context: {
                        budget: campaign.decisionBudget,
                        includeRecorded: campaign.decisionIncludeRecorded === 1,
                        sharePercent: campaign.decisionSharePercent ?? DEFAULT_CONTEXT.sharePercent,
                      },
                      forecastPick: campaign.decisionForecastPick,
                      paidPick: campaign.decisionPaidPick,
                    }
                  : null,
              ),
            );
          }
          return respond(scorecard(rows));
        }
        if (request.method === 'POST' && path === '/api/dev/fault') {
          const body = await jsonBody(request);
          if (
            ![
              'lose_next_response',
              'capture_pending',
              'decline_next_capture',
              'decline_next_card',
              'refund_pending',
              'refund_fails',
            ].includes(String(body.kind))
          )
            throw new HttpError(400, 'INVALID_FAULT', 'Choose an available fault.');
          await store.run(
            'INSERT INTO caps(key,day,used) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET day=excluded.day,used=1',
            `fault:${sid}`,
            body.kind,
          );
          return respond({ ok: true, label: 'Simulated failure (dev route)' });
        }
        const match = path.match(/^\/api\/preorders\/([^/]+)\/(return|reconcile)$/);
        if (request.method === 'POST' && match) {
          const row = await ownPreorderOrBuyer(store, match[1], sid);
          await webhooks.replay(row.campaignId);
          const body = await jsonBody(request);
          if (body.cancel !== undefined && typeof body.cancel !== 'boolean')
            throw new HttpError(400, 'INVALID_CANCEL', 'Cancel must be true or false.');
          const preorder =
            match[2] === 'return'
              ? await preorders.returned(row.id, body.cancel === true)
              : await preorders.reconcile(row.id);
          return respond({ preorder: publicPreorder(preorder) });
        }
        const retry = path.match(/^\/api\/campaign\/refunds\/([^/]+)\/retry$/);
        if (request.method === 'POST' && retry) {
          const row = await ownPreorder(store, retry[1], sid);
          await webhooks.replay(row.campaignId);
          return respond(await campaigns.retry(row.id));
        }
        const sharedMatch = path.match(/^\/api\/shared\/([^/]+)(?:\/(preorders))?$/);
        if (sharedMatch) {
          const token = sharedMatch[1];
          const isPreorders = sharedMatch[2] === 'preorders';
          const campaign = await store.first<CampaignRow>(
            'SELECT * FROM campaigns WHERE shareToken=? AND shareToken IS NOT NULL',
            token,
          );
          if (!campaign) throw new HttpError(404, 'NOT_FOUND', 'Campaign not found or link revoked.');
          if (!isPreorders) {
            if (request.method !== 'GET')
              throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This route does not accept that method.');
            const allRows = await store.preorders(campaign.id);
            const liveCaptured = allRows.filter((p) => p.source === 'live' && p.state === 'captured');
            const venueList = venues.map((v) => ({
              id: v.id,
              forecastUnits: forecastUnits(v),
              paidUnits: liveCaptured.filter((p) => p.venue === v.id).reduce((sum, p) => sum + p.qty, 0),
            }));
            const mine = allRows.filter((p) => p.buyerSessionId === sid).map(publicPreorder);
            return respond({
              campaignState: campaign.state,
              chosen: campaign.chosen,
              venues: venueList,
              catalog,
              mine,
            });
          }
          if (request.method !== 'POST')
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This route does not accept that method.');
          if (campaign.state !== 'open')
            throw new HttpError(409, 'CAMPAIGN_CLOSED', 'This campaign is no longer open.');
          const body = await jsonBody(request);
          const result = await preorders.create(campaign, body, url.origin, sid);
          return respond({ ...result, preorder: publicPreorder(result.preorder) });
        }
        if (path === '/api/campaign/share' || path === '/api/campaign/share/revoke') {
          if (request.method !== 'POST')
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This route does not accept that method.');
          const body = await jsonBody(request);
          const campaign =
            typeof body.campaignId === 'string'
              ? await ownCampaign(store, body.campaignId, sid)
              : await currentCampaign(store, sid);
          if (path === '/api/campaign/share') {
            if (campaign.state !== 'open')
              throw new HttpError(409, 'CAMPAIGN_CLOSED', 'This campaign is no longer open.');
            if (campaign.shareToken) return respond({ shareToken: campaign.shareToken });
            const shareToken = crypto.randomUUID().replaceAll('-', '');
            await store.run('UPDATE campaigns SET shareToken=? WHERE id=?', shareToken, campaign.id);
            return respond({ shareToken });
          }
          await store.run('UPDATE campaigns SET shareToken=NULL WHERE id=?', campaign.id);
          return respond({ ok: true });
        }
        if (!['/api/campaign', '/api/preorders', '/api/campaign/close', '/api/campaign/reset'].includes(path))
          throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
        if (
          (path === '/api/campaign' && request.method !== 'GET') ||
          (path !== '/api/campaign' && request.method !== 'POST')
        )
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This route does not accept that method.');
        const body = request.method === 'POST' ? await jsonBody(request) : {};
        const campaign =
          typeof body.campaignId === 'string'
            ? await ownCampaign(store, body.campaignId, sid)
            : await currentCampaign(store, sid);
        if (request.method === 'GET') return respond(await campaigns.view(campaign.id));
        if (path === '/api/preorders') {
          const result = await preorders.create(campaign, body, url.origin);
          return respond({ ...result, preorder: publicPreorder(result.preorder) });
        }
        if (path === '/api/campaign/close') {
          const context = parseContext(body.context);
          if (!context)
            throw new HttpError(400, 'INVALID_CONTEXT', 'Choose the budget, evidence and share from the screen.');
          return respond(await campaigns.close(campaign.id, venueId(body.venue), context));
        }
        return respond(await campaigns.reset(campaign));
      } catch (error) {
        if (error instanceof HttpError)
          return respond({ error: error.code, message: error.message }, error.status);
        return respond(
          {
            error: 'SERVICE_UNAVAILABLE',
            message: 'The service is unavailable. Payment state has been kept. Try again.',
          },
          503,
        );
      }
    },
  };
}
export default createWorker() satisfies ExportedHandler<Env>;
