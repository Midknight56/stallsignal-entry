import { Store, type CampaignRow } from './engine/store';
import { HttpError } from './errors';

export async function session(
  request: Request,
  store: Store,
): Promise<{ id: string; cookie: string | null }> {
  const supplied = request.headers.get('cookie')?.match(/(?:^|;\s*)ss_sid=([a-f0-9]{32})(?:;|$)/)?.[1];
  if (supplied && (await store.first('SELECT id FROM sessions WHERE id=?', supplied)))
    return { id: supplied, cookie: null };
  const id = crypto.randomUUID().replaceAll('-', '');
  await store.run('INSERT INTO sessions(id,createdAt) VALUES(?,?)', id, store.now());
  return {
    id,
    cookie: `ss_sid=${id}; Path=/; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
  };
}
export async function currentCampaign(store: Store, sessionId: string): Promise<CampaignRow> {
  const prior = await store.first<CampaignRow>(
    'SELECT * FROM campaigns WHERE sessionId=? ORDER BY rowid DESC LIMIT 1',
    sessionId,
  );
  if (prior) return prior;
  const id = crypto.randomUUID().replaceAll('-', '');
  await store.run(
    "INSERT OR IGNORE INTO campaigns(id,sessionId,state,createdAt) VALUES(?,?,'open',?)",
    id,
    sessionId,
    store.now(),
  );
  return (await store.first<CampaignRow>(
    'SELECT * FROM campaigns WHERE sessionId=? ORDER BY rowid DESC LIMIT 1',
    sessionId,
  ))!;
}
export async function ownCampaign(store: Store, id: string, sessionId: string): Promise<CampaignRow> {
  const row = await store.campaign(id);
  if (!row || row.sessionId !== sessionId)
    throw new HttpError(403, 'NOT_YOUR_CAMPAIGN', 'This campaign belongs to another session.');
  return row;
}
export async function ownPreorder(store: Store, id: string, sessionId: string) {
  const row = await store.preorder(id);
  if (!row) throw new HttpError(403, 'NOT_YOUR_CAMPAIGN', 'This preorder belongs to another session.');
  await ownCampaign(store, row.campaignId, sessionId);
  return row;
}
export async function ownPreorderOrBuyer(store: Store, id: string, sessionId: string) {
  const row = await store.preorder(id);
  if (!row) throw new HttpError(403, 'NOT_YOUR_CAMPAIGN', 'This preorder belongs to another session.');
  if (row.buyerSessionId === sessionId) return row;
  await ownCampaign(store, row.campaignId, sessionId);
  return row;
}
