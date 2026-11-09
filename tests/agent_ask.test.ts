import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askStudio, keywordMatch } from '../src/agent/ask';
import { sanitizeTitle } from '../web/src/studio/addWidget';
import { visitorId } from '../src/agent/limits';
import { createWorker } from '../src/index';
import { MemoryDatabase } from './helpers/database';

describe('Studio ask and routes', () => {
  let db: MemoryDatabase;
  beforeEach(() => {
    db = new MemoryDatabase();
    db.sqlite.exec('CREATE TABLE ai_calls(id INTEGER PRIMARY KEY,app TEXT,day TEXT,neurons REAL,at TEXT)');
  });
  afterEach(() => db.close());
  const now = Date.parse('2026-11-06T12:00:00Z');
  it.each([
    ['too high at Shed 9', 'overestimated', 'wharf'],
    ['underestimated Millrace Hall', 'underestimated', 'mill'],
    ['refunds at Linden Corner Shop', 'refunds_open', 'linden'],
    ['Wharf', 'by_venue', 'wharf'],
    ['paid versus forecast', 'paid_vs_forecast', null],
    ['purple flying spoons', 'paid_vs_forecast', null],
  ])('matches %s', (q, view, venue) =>
    expect(keywordMatch(q)).toEqual({ view, venue, source: 'matched', add: null }),
  );
  it('weird question and invalid answer use matching', async () => {
    const answer = await askStudio('flying spoons', {
      db,
      ledger: db,
      visitor: 'one',
      now,
      model: { run: async () => ({ response: '{"view":"fake","venue":"moon"}', usage: { neurons: 1 } }) },
    });
    expect(answer.source).toBe('matched');
    expect(db.sqlite.prepare('SELECT neurons FROM ai_calls').get()?.neurons).toBe(1);
  });
  it('valid ask uses one call and the shared ledger', async () => {
    const run = vi.fn(async () => ({
      response: '{"view":"refunds_open","venue":"mill","add":null}',
      usage: { neurons: 0.9 },
    }));
    expect(await askStudio('refund mill', { db, ledger: db, visitor: 'one', now, model: { run } })).toEqual({
      view: 'refunds_open',
      venue: 'mill',
      source: 'ai',
      add: null,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('only twelve asks per visitor per UTC day', async () => {
    const run = vi.fn(async () => ({ response: '{"view":"by_venue","venue":null}', usage: { neurons: 1 } }));
    const deps = { db, ledger: db, visitor: 'one', now, model: { run } };
    for (let i = 0; i < 13; i++) await askStudio('hello', deps);
    expect(run).toHaveBeenCalledTimes(12);
    expect((await askStudio('hello', { ...deps, now: now + 86400000 })).source).toBe('ai');
  });
  it('hashes IP and browser rather than session cookies', async () => {
    const req = (cookie: string) =>
      new Request('https://demo.test', {
        headers: { 'cf-connecting-ip': '127.0.0.1', 'user-agent': 'test', cookie },
      });
    expect(await visitorId(req('a'))).toBe(await visitorId(req('b')));
  });
  it('routes reject invalid inputs and preserve origin checks', async () => {
    const worker = createWorker({ clock: () => now });
    const env = { DB: db, ASSETS: { fetch: async () => new Response('asset') } };
    const post = (path: string, body: object, origin?: string) =>
      worker.fetch(
        new Request('https://demo.test' + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
          body: JSON.stringify(body),
        }),
        env,
      );
    expect((await post('/api/agent', { budget: 100 })).status).toBe(400);
    expect((await post('/api/ask', { q: 'x'.repeat(201) })).status).toBe(400);
    expect((await post('/api/ask', { q: 'refund' }, 'https://evil.test')).status).toBe(403);
    const answer = (await (await post('/api/agent', { budget: 90000 })).json()) as { source: string; fallback: string };
    expect(answer.source).toBe('code');
    expect(answer.fallback).toBe('model_off');
    expect(await (await post('/api/ask', { q: 'refund' })).json()).toEqual({
      view: 'refunds_open',
      venue: null,
      source: 'matched',
      add: null,
    });
  });
  it('keyword match gives each kind for a sample sentence and null for Only Millrace Hall', () => {
    expect(keywordMatch('Chart refunds by venue').add).toBe('refunds_by_venue');
    expect(keywordMatch('Graph refund counts').add).toBe('refunds_by_venue');
    expect(keywordMatch('Chart paid demand').add).toBe('paid_by_venue');
    expect(keywordMatch('Preorders by state').add).toBe('preorders_by_state');
    expect(keywordMatch('Pie of preorders').add).toBe('preorders_by_state');
    expect(keywordMatch('Table of pending payments').add).toBe('pending_payments');
    expect(keywordMatch('Grid pending orders').add).toBe('pending_payments');
    expect(keywordMatch('Only Millrace Hall').add).toBeNull();
  });
  it('model answer with a bad kind falls back to keyword match', async () => {
    const run = vi.fn(async () => ({
      response: '{"view":"by_venue","venue":"mill","add":"unknown_kind"}',
      usage: { neurons: 1 },
    }));
    const answer = await askStudio('chart refunds by venue', {
      db,
      ledger: db,
      visitor: 'one',
      now,
      model: { run },
    });
    expect(answer.source).toBe('matched');
    expect(answer.add).toBe('refunds_by_venue');
  });
  it('title check refuses a long or odd title and uses Chart default', () => {
    expect(sanitizeTitle('A'.repeat(61))).toBe('Chart');
    expect(sanitizeTitle('Weird <script> title!')).toBe('Chart');
    expect(sanitizeTitle('')).toBe('Chart');
    expect(sanitizeTitle('   ')).toBe('Chart');
    expect(sanitizeTitle('Valid Title 123')).toBe('Valid Title 123');
  });
});
