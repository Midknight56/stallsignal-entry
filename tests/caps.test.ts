import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_NEURONS_PER_DAY,
  APP_NEURONS_PER_DAY,
  RESERVE_PER_CALL,
  reserveNeurons,
  settleNeurons,
} from '../src/caps';
import type { Database } from '../src/engine/store';
import { world } from './helpers/world';

describe('atomic cap failures', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
    w.db.sqlite.exec('CREATE TABLE ai_calls(id INTEGER PRIMARY KEY,app TEXT,day TEXT,neurons REAL,at TEXT)');
  });
  afterEach(() => {
    w.db.close();
  });
  it('session daily cap rejects preorder eleven before a PayPal call', async () => {
    const v = w.visitor();
    for (let i = 0; i < 10; i++) await v.paid();
    const response = await v.api('/api/preorders', { venue: 'mill', product: 'tin', qty: 1 });
    expect(response.status).toBe(409);
    expect(w.pp.count('create')).toBe(10);
  });
  it('reset cannot bypass the session daily cap and a new UTC day resets the cap', async () => {
    const v = w.visitor();
    for (let i = 0; i < 10; i++) await v.paid('mill');
    await v.api('/api/campaign/close', { venue: 'mill' });
    await v.api('/api/campaign/reset', {});
    expect((await v.api('/api/preorders', { venue: 'mill', product: 'tin', qty: 1 })).status).toBe(409);
    w.advance(86400000);
    expect((await v.create()).state).toBe('created');
  });
  it('concurrent creates cannot exceed the final available session slot', async () => {
    const v = w.visitor();
    for (let i = 0; i < 9; i++) await v.paid();
    const responses = await Promise.all([
      v.api('/api/preorders', { venue: 'mill', product: 'tin', qty: 1 }),
      v.api('/api/preorders', { venue: 'mill', product: 'tin', qty: 1 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(w.pp.count('create')).toBe(10);
  });
  it('app wide daily cap stops all sessions at 400 preorders', async () => {
    const a = w.visitor();
    const c = await a.campaign();
    const insert = w.db.sqlite.prepare(
      "INSERT INTO preorders(id,campaignId,venue,product,qty,amountCents,state,createdAt,updatedAt) VALUES(?,?,'wharf','tin',1,1400,'canceled',?,?)",
    );
    for (let i = 0; i < 400; i++) insert.run(`existing${i}`, c.id, w.store.now(), w.store.now());
    const other = w.visitor();
    expect((await other.api('/api/preorders', { venue: 'mill', product: 'tin', qty: 1 })).status).toBe(409);
    expect(w.pp.count('create')).toBe(0);
  });
  it('ledger refuses a reservation over either the app or account cap', async () => {
    const day = '2026-11-06';
    await w.store.run(
      'INSERT INTO ai_calls(app,day,neurons,at) VALUES(?,?,?,?)',
      'stallsignal',
      day,
      APP_NEURONS_PER_DAY - RESERVE_PER_CALL + 1,
      w.store.now(),
    );
    expect(await reserveNeurons(w.db, day)).toBeNull();
    w.db.sqlite.exec('DELETE FROM ai_calls');
    await w.store.run(
      'INSERT INTO ai_calls(app,day,neurons,at) VALUES(?,?,?,?)',
      'other-app',
      day,
      ACCOUNT_NEURONS_PER_DAY - RESERVE_PER_CALL + 1,
      w.store.now(),
    );
    expect(await reserveNeurons(w.db, day)).toBeNull();
  });
  it('two ledger reservations racing for the last slot admit exactly one', async () => {
    const day = '2026-11-06';
    await w.store.run(
      'INSERT INTO ai_calls(app,day,neurons,at) VALUES(?,?,?,?)',
      'stallsignal',
      day,
      APP_NEURONS_PER_DAY - RESERVE_PER_CALL,
      w.store.now(),
    );
    const ids = await Promise.all([reserveNeurons(w.db, day), reserveNeurons(w.db, day)]);
    expect(ids.filter((id) => id !== null)).toHaveLength(1);
    expect((await w.store.first<{ n: number }>('SELECT SUM(neurons) AS n FROM ai_calls'))?.n).toBe(
      APP_NEURONS_PER_DAY,
    );
  });
  it('ledger down fails closed and cannot authorize a call', async () => {
    const down: Database = {
      prepare() {
        throw new Error('Ledger unavailable');
      },
    };
    expect(await reserveNeurons(down, '2026-11-06')).toBeNull();
  });
  it('unknown usage retains the reservation and measured usage replaces only our own row', async () => {
    const id = (await reserveNeurons(w.db, '2026-11-06'))!;
    await settleNeurons(w.db, id, null);
    expect(
      (await w.store.first<{ neurons: number }>('SELECT neurons FROM ai_calls WHERE id=?', id))?.neurons,
    ).toBe(RESERVE_PER_CALL);
    await settleNeurons(w.db, id, 8.3);
    expect(
      (await w.store.first<{ neurons: number }>('SELECT neurons FROM ai_calls WHERE id=?', id))?.neurons,
    ).toBe(8.3);
  });
});
