import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEPRECATED_MODELS,
  MAX_TURN_INPUT_CHARS,
  MODEL_ID,
  RESERVE_PER_CALL,
  modelAllowed,
} from '../src/caps';
import { makeFacts, type Evidence } from '../src/agent/facts';
import { reserve, settle } from '../src/agent/ledger';
import { boundMessages, callModel, type Model, type ModelInput } from '../src/agent/model';
import { cacheKey, codeAnswer, runAgent } from '../src/agent/run';
import { decide } from '../src/domain/blend';
import { scorecard } from '../src/domain/scorecard';
import { venues } from '../src/data/venues';
import { MemoryDatabase } from './helpers/database';
import type { Database } from '../src/engine/store';
import type { Preorder } from '../src/shared/types';

const now = Date.parse('2026-11-06T12:00:00Z');
const day = '2026-11-06';
const input: Evidence = { budget: 90000, preorders: [], recorded: [] };
const good = { pick: 'wharf', facts: ['F1', 'F3'], risk: 'low' };
describe('agent run', () => {
  let db: MemoryDatabase;
  beforeEach(() => {
    db = new MemoryDatabase();
    db.sqlite.exec('CREATE TABLE ai_calls(id INTEGER PRIMARY KEY,app TEXT,day TEXT,neurons REAL,at TEXT)');
  });
  afterEach(() => db.close());
  const down: Database = {
    prepare() {
      throw new Error('unavailable');
    },
  };
  const model = (answer: unknown = good) => {
    return {
      run: vi.fn(async (_model: string, request: ModelInput) => ({
        ...(request.messages.length === 2 && request.tools
          ? {
              tool_calls: [
                {
                  name: 'read_location_evidence',
                  arguments: { venue: (answer as { pick?: string })?.pick === 'mill' ? 'mill' : 'wharf' },
                },
              ],
            }
          : { choices: [{ message: { content: JSON.stringify(answer) } }] }),
        usage: { neurons: 1.26 },
      })),
    };
  };
  function deps(m: Model = model()) {
    return { db, ledger: db, model: m, visitor: 'visitor', now };
  }
  function seed(app: string, neurons: number) {
    db.sqlite
      .prepare('INSERT INTO ai_calls(app,day,neurons,at) VALUES(?,?,?,?)')
      .run(app, day, neurons, new Date(now).toISOString());
  }
  it('uses an allowed model and the documented reservation bound', () => {
    expect(DEPRECATED_MODELS).not.toContain(MODEL_ID);
    expect(modelAllowed()).toBe(true);
    for (const id of DEPRECATED_MODELS) expect(modelAllowed(id)).toBe(false);
    expect(RESERVE_PER_CALL).toBe(15);
    expect((4064 * 1542 + 160 * 10158) / 1e6).toBeLessThan(15);
  });
  it('refuses over the app cap', async () => {
    seed('stallsignal', 886);
    expect(await reserve(db, day)).toBeNull();
  });
  it('refuses over the account cap', async () => {
    seed('other', 8986);
    expect(await reserve(db, day)).toBeNull();
  });
  it('only one simultaneous reservation fits', async () => {
    seed('stallsignal', 885);
    const ids = await Promise.all([reserve(db, day), reserve(db, day)]);
    expect(ids.filter((id) => id !== null)).toHaveLength(1);
  });
  it('ledger down returns the code answer without spending', async () => {
    const m = model();
    const answer = await runAgent(input, { ...deps(m), ledger: down });
    expect(answer.source).toBe('code');
    expect(answer.steps).toEqual([]);
    expect(m.run).not.toHaveBeenCalled();
  });
  it.each([
    { ...good, pick: 'fake' },
    { ...good, facts: ['F1', 'F99'] },
    { ...good, facts: ['F1', 'F2', 'F3', 'F4', 'F5'] },
    { ...good, facts: ['F5', 'F6'] },
    { ...good, facts: ['F1', 'F1'] },
    { ...good, risk: 'certain' },
  ])('rejects invalid selections %j', async (answer) => {
    const result = await runAgent(input, deps(model(answer)));
    expect(result.source).toBe('code');
    expect(result.pick).toBe(decide().decided);
    expect(result.neurons.used).toBeCloseTo(3 * 1.26);
  });
  it('rejects a venue with nonpositive margin', async () => {
    const result = await runAgent({ ...input, budget: 15000 }, deps(model(good)));
    expect(result.source).toBe('code');
  });
  it('accepts fenced full fact lines but writes only domain fact text', async () => {
    let turn = 0;
    const m = {
      run: vi.fn(async () =>
        turn++ === 0
          ? {
              tool_calls: [{ name: 'read_location_evidence', arguments: { venue: 'wharf' } }],
              usage: { neurons: 1.26 },
            }
          : {
              response:
                '```json\n' +
                JSON.stringify({ ...good, facts: ['F1 fabricated 999999', 'F3 invented price'] }) +
                '\n```',
              usage: { neurons: 1.26 },
            },
      ),
    };
    const answer = await runAgent(input, deps(m));
    expect(answer.source).toBe('ai');
    expect(answer.facts).toEqual(
      makeFacts(input)
        .filter((f) => good.facts.includes(f.id))
        .map(({ id, text }) => ({ id, text })),
    );
    expect(answer.steps?.map((s) => s.tool)).toEqual(['read_location_evidence', 'compare_sites']);
    const [id, params] = m.run.mock.calls.at(-1) as unknown as [
      string,
      { messages: { content: string }[]; max_tokens: number; response_format: { type: string } },
    ];
    expect(id).toBe(MODEL_ID);
    expect(params.max_tokens).toBe(160);
    expect(params.response_format.type).toBe('json_schema');
    expect(JSON.stringify(params).length).toBeLessThanOrEqual(MAX_TURN_INPUT_CHARS);
  });
  it('accepts realistic id only model output', async () => {
    const m = model({ pick: 'mill', facts: ['F5', 'F8'], risk: 'medium' });
    const answer = await runAgent(input, deps(m));
    expect(answer.source).toBe('ai');
    expect(answer.pick).toBe('mill');
    expect(answer.facts.map((f) => f.id)).toEqual(['F5', 'F8']);
  });
  it('cache hits spend nothing and do not take another run slot', async () => {
    const m = model();
    await runAgent(input, deps(m));
    const answer = await runAgent(input, deps(m));
    expect(answer.source).toBe('cache');
    expect(answer.neurons.used).toBe(0);
    expect(answer.neurons.reserved).toBe(0);
    expect(m.run).toHaveBeenCalledTimes(3);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM runs').get()?.n).toBe(1);
  });
  it('drops obsolete invented steps from saved answers', async () => {
    const key = await cacheKey(input);
    const answer = { ...codeAnswer(input), steps: [{ tool: 'compare_sites', venue: null }] };
    db.sqlite
      .prepare('INSERT INTO agent_cache(key,body,expiresAt) VALUES(?,?,?)')
      .run(key, JSON.stringify(answer), new Date(now + 86400000).toISOString());
    expect(await runAgent(input, deps())).not.toHaveProperty('steps');
  });
  it('returns steps for a cached loop 1 entry', async () => {
    const key = await cacheKey(input);
    const steps = [{ tool: 'compare_sites', label: 'Compared the three venues' }];
    const answer = { ...codeAnswer(input), steps, loop: 1 };
    db.sqlite
      .prepare('INSERT INTO agent_cache(key,body,expiresAt) VALUES(?,?,?)')
      .run(key, JSON.stringify(answer), new Date(now + 86400000).toISOString());
    const result = await runAgent(input, deps());
    expect(result.source).toBe('cache');
    expect(result.steps).toEqual(steps);
  });
  it('cache expires after 24 hours', async () => {
    const m = model();
    await runAgent(input, deps(m));
    await runAgent(input, { ...deps(m), now: now + 86400001 });
    expect(m.run).toHaveBeenCalledTimes(6);
  });
  it('visitor cap is atomic and independent of cookies', async () => {
    for (let i = 0; i < 11; i++)
      db.sqlite.prepare('INSERT INTO runs(day,visitor,at) VALUES(?,?,?)').run(day, 'visitor', 'now');
    const m = model();
    const answers = await Promise.all([
      runAgent(input, deps(m)),
      runAgent({ ...input, budget: 85000 }, deps(m)),
    ]);
    expect(answers.map((a) => a.source).sort()).toEqual(['ai', 'code']);
    expect(answers.find((a) => a.source === 'code')?.fallback).toBe('run_limit');
    expect(m.run).toHaveBeenCalledTimes(3);
  });
  it('app cap refuses run 201', async () => {
    for (let i = 0; i < 200; i++)
      db.sqlite.prepare('INSERT INTO runs(day,visitor,at) VALUES(?,?,?)').run(day, String(i), 'now');
    const m = model();
    const answer = await runAgent(input, deps(m));
    expect(answer.source).toBe('code');
    expect(answer.fallback).toBe('run_limit');
    expect(m.run).not.toHaveBeenCalled();
  });
  it('unknown model outcome retains all reserved neurons', async () => {
    const m = {
      run: vi.fn(async () => {
        throw new Error('timeout');
      }),
    };
    expect((await runAgent(input, deps(m))).source).toBe('code');
    expect(db.sqlite.prepare('SELECT neurons FROM ai_calls').get()?.neurons).toBe(15);
  });
  it('missing usage keeps the reservation and marks usage unknown', async () => {
    let turn = 0;
    const answer = await runAgent(
      input,
      deps({
        run: async () =>
          turn++ === 0
            ? { tool_calls: [{ name: 'read_location_evidence', arguments: { venue: 'wharf' } }] }
            : { response: JSON.stringify(good) },
      }),
    );
    expect(answer.source).toBe('ai');
    expect(answer.usageUnknown).toBe(true);
    expect(db.sqlite.prepare('SELECT SUM(neurons) AS n FROM ai_calls').get()?.n).toBe(45);
  });
  it('settlement failure keeps the reservation without throwing', async () => {
    await expect(settle(down, 1, 1.26)).resolves.toBeUndefined();
  });
  it('bounds whole input lines while preserving system rules', () => {
    const bounded = boundMessages([
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'F1 valid\n' + 'x'.repeat(3000) },
    ]);
    expect(bounded.map((m) => m.content)).toEqual(['rules', 'F1 valid']);
  });
  it('uses token rates when measured neurons are absent', async () => {
    const result = await callModel(
      { run: async () => ({ response: '{}', usage: { prompt_tokens: 273, completion_tokens: 83 } }) },
      [],
      {},
    );
    expect(result.used).toBe(1.27);
  });
  it('rejects parseable cut JSON when the model reports length', async () => {
    const result = await callModel(
      {
        run: async () => ({
          choices: [{ message: { content: JSON.stringify(good) }, finish_reason: 'length' }],
          usage: { neurons: 1 },
        }),
      },
      [],
      {},
    );
    expect(result.answer).toBeNull();
  });
  it('facts contain exactly the values computed by the domain', () => {
    for (const budget of [15000, 45000, 90000, 150000]) {
      const evidence = { ...input, budget };
      const facts = makeFacts(evidence);
      const decision = decide([], budget);
      expect(facts).toHaveLength(12);
      expect(facts.map((f) => f.id)).toEqual(Array.from({ length: 12 }, (_, i) => `F${i + 1}`));
      venues.forEach((v, i) => {
        const row = decision.venues[i];
        const prefix = v.name + ': ';
        const money = (cents: number) =>
          new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
        expect(facts[i * 4].text).toBe(
          prefix +
            `forecast ${row.forecastUnits} units, expected margin ${money(row.marginCents)} at this stock budget (synthetic history).`,
        );
        expect(facts[i * 4 + 1].text).toBe(
          prefix +
            'past forecasts were ' +
            scorecard()
              .history.filter((h) => h.venue === v.id && h.season !== 'summer')
              .map(
                (h) =>
                  `${Math.abs(Math.round(h.errorPercent))}% too ${h.errorPercent > 0 ? 'high' : 'low'} in ${h.season}`,
              )
              .join(' and ') +
            ' (synthetic history).',
        );
        expect(facts[i * 4 + 2].text).toBe(
          prefix + `${row.recordedUnits} paid preorder units so far (recorded run).`,
        );
        expect(facts[i * 4 + 3].text).toBe(
          prefix +
            `with preorders counted, about ${Math.round(row.blendedUnits)} units and ${money(row.marginCents)} expected margin.`,
        );
      });
      const answer = codeAnswer(evidence);
      expect(answer.stockCostCents).toBeLessThanOrEqual(budget);
    }
    const facts = makeFacts(input);
    expect(facts.find((f) => f.venue === 'wharf' && f.text.includes('past forecasts'))?.text).toBe(
      'Shed 9 at the Wharf: past forecasts were 56% too high in autumn and 76% too high in winter (synthetic history).',
    );
    expect(facts.find((f) => f.venue === 'mill' && f.text.includes('past forecasts'))?.text).toBe(
      'Millrace Hall: past forecasts were 18% too low in autumn and 21% too low in winter (synthetic history).',
    );
  });
  it('keeps all venue facts within the cap with live and recorded demand', () => {
    const payment: Preorder = {
      id: 'live',
      venue: 'mill',
      qty: 3,
      product: 'tin',
      amountCents: 4200,
      state: 'captured',
      source: 'live',
      captureId: 'capture',
      orderId: null,
      refundId: null,
      debugId: null,
      updatedAt: '',
    };
    const preorders = venues.map((v) => ({ ...payment, id: `live-${v.id}`, venue: v.id }));
    const recorded = venues.map((v) => ({
      ...payment,
      id: `recorded-${v.id}`,
      venue: v.id,
      qty: 2,
      source: 'recorded' as const,
      state: 'refunded' as const,
    }));
    for (const budget of [15000, 45000, 90000, 150000]) {
      const facts = makeFacts({ budget, preorders, recorded });
      const decision = decide(preorders, budget, recorded);
      expect(facts).toHaveLength(15);
      for (const row of decision.venues) {
        const venueFacts = facts.filter((f) => f.venue === row.id).map((f) => f.text);
        expect(venueFacts).toHaveLength(5);
        expect(venueFacts[2]).toContain(`${row.recordedUnits} paid preorder units`);
        expect(venueFacts[3]).toContain(`${row.paidUnits} paid preorder units`);
        expect(venueFacts[4]).toContain(`about ${Math.round(row.blendedUnits)} units`);
        expect(venueFacts[4]).toContain(
          new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
            row.marginCents / 100,
          ),
        );
      }
    }
  });
  it('cache distinguishes order count at equal paid unit totals', async () => {
    const p: Preorder = {
      id: 'one',
      venue: 'mill',
      qty: 2,
      product: 'tin',
      amountCents: 2800,
      state: 'captured',
      source: 'live',
      captureId: 'cap',
      orderId: null,
      refundId: null,
      debugId: null,
      updatedAt: '',
    };
    expect(await cacheKey({ ...input, preorders: [p] })).not.toBe(
      await cacheKey({
        ...input,
        preorders: [
          { ...p, qty: 1 },
          { ...p, id: 'two', qty: 1 },
        ],
      }),
    );
  });
  it('facts reflect captured live demand and refunded recorded evidence separately', () => {
    const p: Preorder = {
      id: 'one',
      venue: 'mill',
      qty: 3,
      product: 'tin',
      amountCents: 4200,
      state: 'captured',
      source: 'live',
      captureId: 'cap',
      orderId: null,
      refundId: null,
      debugId: null,
      updatedAt: '',
    };
    const evidence = {
      ...input,
      preorders: [p, { ...p, id: 'pending', state: 'pending' as const }],
      recorded: [{ ...p, id: 'recorded', qty: 2, source: 'recorded' as const, state: 'refunded' as const }],
    };
    const facts = makeFacts(evidence);
    const row = decide(evidence.preorders, evidence.budget, evidence.recorded).venues[1];
    expect(facts.filter((f) => f.venue === 'mill').map((f) => f.text)).toContain(
      'Millrace Hall: 3 paid preorder units so far (this campaign).',
    );
    expect(facts.filter((f) => f.venue === 'mill').map((f) => f.text)).toContain(
      'Millrace Hall: 2 paid preorder units so far (recorded run).',
    );
    expect(facts.find((f) => f.venue === 'mill' && f.text.includes('with preorders'))?.text).toBe(
      `Millrace Hall: with preorders counted, about ${Math.round(row.blendedUnits)} units and ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(row.marginCents / 100)} expected margin.`,
    );
    expect(facts).toHaveLength(13);
    expect(facts.every((f) => !f.text.includes('0 paid preorder units so far (this campaign)'))).toBe(true);
  });
  it.each([15000, 45000, 90000])('budget %i obeys bounds across live, cache, model off, run limit, daily cap, and error', async (budget) => {
    const bInput: Evidence = { budget, preorders: [], recorded: [] };
    const m = model({ pick: 'mill', facts: ['F5', 'F8'], risk: 'medium' });

    // 1. live model answer
    const live = await runAgent(bInput, deps(m));
    expect(live.stockCostCents).toBeLessThanOrEqual(live.budgetCents!);
    expect(live.budgetCents).toBe(budget);
    expect(live.source).toBe('ai');
    expect(live.fallback).toBeUndefined();

    // 2. cache hit
    const cache = await runAgent(bInput, deps(m));
    expect(cache.stockCostCents).toBeLessThanOrEqual(cache.budgetCents!);
    expect(cache.budgetCents).toBe(budget);
    expect(cache.source).toBe('cache');
    expect(cache.fallback).toBeUndefined();

    // Clear cache so remaining tests hit their paths
    db.sqlite.prepare('DELETE FROM agent_cache').run();

    // 3. model off (no model)
    const off = await runAgent(bInput, { ...deps(), model: undefined, visitor: `v-off-${budget}` });
    expect(off.stockCostCents).toBeLessThanOrEqual(off.budgetCents!);
    expect(off.budgetCents).toBe(budget);
    expect(off.source).toBe('code');
    expect(off.fallback).toBe('model_off');

    // 4. run limit reached
    for (let i = 0; i < 12; i++)
      db.sqlite.prepare('INSERT INTO runs(day,visitor,at) VALUES(?,?,?)').run(day, `v-capped-${budget}`, 'now');
    const capped = await runAgent(bInput, { ...deps(m), visitor: `v-capped-${budget}` });
    expect(capped.stockCostCents).toBeLessThanOrEqual(capped.budgetCents!);
    expect(capped.budgetCents).toBe(budget);
    expect(capped.source).toBe('code');
    expect(capped.fallback).toBe('run_limit');

    // 5. daily neuron reservation refused
    seed('stallsignal', 886);
    const refused = await runAgent(bInput, { ...deps(m), visitor: `v-refused-${budget}` });
    expect(refused.stockCostCents).toBeLessThanOrEqual(refused.budgetCents!);
    expect(refused.budgetCents).toBe(budget);
    expect(refused.source).toBe('code');
    expect(refused.fallback).toBe('daily_budget');

    // 6. thrown error
    const errDb: Database = {
      prepare() {
        throw new Error('database failure');
      },
    };
    const errored = await runAgent(bInput, { ...deps(m), db: errDb, visitor: `v-err-${budget}` });
    expect(errored.stockCostCents).toBeLessThanOrEqual(errored.budgetCents!);
    expect(errored.budgetCents).toBe(budget);
    expect(errored.source).toBe('code');
    expect(errored.fallback).toBe('error');
  });
});
