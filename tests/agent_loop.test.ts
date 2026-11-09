import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_OUTPUT_TOKENS, MAX_TURN_INPUT_CHARS, MODEL_ID, RESERVE_PER_CALL } from '../src/caps';
import { boundTurn, loopTools, runToolLoop } from '../src/agent/loop';
import { makeFacts, type Evidence } from '../src/agent/facts';
import { toolArguments, type ModelInput } from '../src/agent/model';
import { cacheKey, runAgent } from '../src/agent/run';
import { allocate } from '../src/domain/allocate';
import { compare_sites } from '../src/agent/tools';
import { venues } from '../src/data/venues';
import type { Database } from '../src/engine/store';
import type { Preorder } from '../src/shared/types';
import { MemoryDatabase } from './helpers/database';

const input: Evidence = { budget: 90000, preorders: [], recorded: [] };
const now = Date.parse('2026-11-08T12:00:00Z');
const pick = { pick: 'mill', facts: ['F5', 'F8'], risk: 'medium' };
const answer = (value: unknown = pick) => ({
  choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }],
  usage: { neurons: 0.28 },
});
function tool(name: string, args: unknown, id = name) {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: args } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { neurons: 0.74 },
  };
}

describe('bounded tool loop', () => {
  let db: MemoryDatabase;
  beforeEach(() => {
    db = new MemoryDatabase();
    db.sqlite.exec('CREATE TABLE ai_calls(id INTEGER PRIMARY KEY,app TEXT,day TEXT,neurons REAL,at TEXT)');
  });
  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });
  function fake(responses: unknown[]) {
    const requests: ModelInput[] = [];
    const run = vi.fn(async (model: string, request: ModelInput) => {
      expect(model).toBe(MODEL_ID);
      expect(request.max_tokens).toBe(MAX_OUTPUT_TOKENS);
      expect(JSON.stringify(request).length).toBeLessThanOrEqual(MAX_TURN_INPUT_CHARS);
      // An unmeasured reservation must already exist before every call.
      const row = db.sqlite.prepare('SELECT neurons FROM ai_calls ORDER BY id DESC LIMIT 1').get();
      expect(row?.neurons).toBe(RESERVE_PER_CALL);
      requests.push(structuredClone(request));
      return responses[Math.min(requests.length - 1, responses.length - 1)];
    });
    return { run, requests };
  }
  const deps = (model: ReturnType<typeof fake>) => ({ model, ledger: db, db, visitor: 'one', now });
  const rows = () =>
    db.sqlite
      .prepare('SELECT neurons FROM ai_calls ORDER BY id')
      .all()
      .map((r) => r.neurons);

  it('reads, compares, stops tools, then takes a schema final turn with four reservations and settles', async () => {
    const model = fake([
      tool('read_location_evidence', '{"venue":"mill"}'),
      tool('compare_sites', '{}'),
      answer(),
      answer(),
    ]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('ai');
    expect(result.steps).toEqual([
      { tool: 'read_location_evidence', venue: 'mill', label: 'Read Millrace Hall evidence' },
      { tool: 'compare_sites', label: 'Compared the three venues' },
    ]);
    expect(model.run).toHaveBeenCalledTimes(4);
    expect(rows()).toEqual([0.74, 0.74, 0.28, 0.28]);
    expect(result.neurons).toEqual({ reserved: 60, used: 2.04, appLeft: 897.96 });
    model.requests.slice(0, 3).forEach((r) => {
      expect(r.tools).toEqual(loopTools);
      expect(r.response_format).toBeUndefined();
    });
    expect(model.requests[3].tools).toBeUndefined();
    expect(model.requests[3].response_format?.type).toBe('json_schema');
    const transcript = model.requests[1].messages;
    expect(transcript[2]).toMatchObject({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'read_location_evidence', type: 'function' }],
    });
    expect(transcript[3]).toMatchObject({ role: 'tool', tool_call_id: 'read_location_evidence' });
    expect(JSON.parse(transcript[3].content).facts).toEqual(
      makeFacts(input)
        .filter((f) => f.venue === 'mill')
        .map(({ id, text }) => ({ id, text })),
    );
    expect(JSON.parse(model.requests[2].messages.at(-1)!.content).venues).toHaveLength(3);
  });

  it.each([
    tool('read_location_evidence', JSON.stringify(JSON.stringify({ venue: 'mill' }))),
    {
      tool_calls: [{ name: 'read_location_evidence', arguments: { venue: 'mill' } }],
      usage: { neurons: 0.69 },
    },
  ])('parses measured arguments and binding response shapes', async (first) => {
    const model = fake([first, answer(), answer()]);
    expect((await runToolLoop(input, deps(model))).source).toBe('ai');
    expect(model.requests[1].messages[2].tool_calls?.[0].function.arguments).toBe('{"venue":"mill"}');
  });

  it('assigns distinct binding tool ids across turns', async () => {
    const model = fake([
      { tool_calls: [{ name: 'read_location_evidence', arguments: { venue: 'mill' } }] },
      { tool_calls: [{ name: 'compare_sites', arguments: {} }] },
      answer(),
      answer(),
    ]);
    await runToolLoop(input, deps(model));
    const calls = model.requests[3].messages.flatMap((m) => m.tool_calls ?? []);
    expect(new Set(calls.map((c) => c.id)).size).toBe(2);
  });

  it('cannot make a fifth call when the model keeps calling distinct tools', async () => {
    const model = fake([
      tool('read_location_evidence', { venue: 'mill' }),
      tool('compare_sites', {}),
      tool('propose_stock_allocation', { venue: 'mill', budget: 1 }),
      tool('read_location_evidence', { venue: 'wharf' }),
    ]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('code');
    expect(model.run).toHaveBeenCalledTimes(4);
    expect(model.requests[3].tools).toBeUndefined();
    expect(model.requests[3].response_format?.type).toBe('json_schema');
    expect(result.steps).toEqual([]); // Code answers have no displayed model steps.
    expect(model.requests[3].messages.filter((m) => m.role === 'tool')).toHaveLength(3);
    expect(rows()).toEqual([0.74, 0.74, 0.74, 0.74]);
  });

  it.each(['stallsignal', 'other'])(
    'refuses turn two against the %s cap and retains the first step',
    async (app) => {
      db.sqlite
        .prepare('INSERT INTO ai_calls(app,day,neurons,at) VALUES(?,?,?,?)')
        .run(app, '2026-11-08', app === 'stallsignal' ? 885 : 8985, 'now');
      const model = fake([
        { ...tool('read_location_evidence', { venue: 'mill' }), usage: { neurons: 15 } },
        answer(),
      ]);
      const result = await runToolLoop(input, deps(model));
      expect(result.source).toBe('code');
      expect(result.steps).toHaveLength(1);
      expect(result.neurons.used).toBe(15);
      expect(model.run).toHaveBeenCalledTimes(1);
      expect(rows()).toHaveLength(2);
      expect(rows().at(-1)).toBe(15);
    },
  );

  it.each([
    tool('invent_tool', {}),
    tool('read_location_evidence', { venue: 'moon' }),
    tool('read_location_evidence', { venue: 'mill', extra: 1 }),
    tool('propose_stock_allocation', { venue: 'mill', budget: -1 }),
    tool('propose_stock_allocation', { venue: 'mill', budget: '90000' }),
    tool('propose_stock_allocation', { venue: 'mill' }),
    tool('read_location_evidence', 'not json'),
    tool('read_location_evidence', '[]'),
    tool('read_location_evidence', JSON.stringify(JSON.stringify(JSON.stringify({ venue: 'mill' })))),
    { ...tool('read_location_evidence', { venue: 'mill' }), choices: [{ finish_reason: 'length' }] },
    {
      tool_calls: [{ name: 'read_location_evidence', arguments: { venue: 'mill' } }],
      finish_reason: 'length',
      usage: { neurons: 0.74 },
    },
  ])('fails closed on invalid calls and length responses', async (response) => {
    const model = fake([response]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('code');
    expect(result.steps).toEqual([]);
    expect(model.run).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual([0.74]);
  });

  it('settles usage and rejects a final length response even if JSON is complete', async () => {
    const model = fake([
      tool('read_location_evidence', { venue: 'mill' }),
      answer(),
      {
        choices: [{ message: { content: JSON.stringify(pick) }, finish_reason: 'length' }],
        usage: { neurons: 0.64 },
      },
    ]);
    expect((await runToolLoop(input, deps(model))).source).toBe('code');
    expect(rows()).toEqual([0.74, 0.28, 0.64]);
  });

  it('rejects repeated calls after normalizing argument encoding', async () => {
    const model = fake([
      tool('read_location_evidence', { venue: 'mill' }),
      tool('read_location_evidence', '{ "venue": "mill" }'),
    ]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('code');
    expect(result.steps).toEqual([]);
    expect(model.run).toHaveBeenCalledTimes(2);
  });

  it('rejects citations from a venue the model never read', async () => {
    const model = fake([tool('read_location_evidence', { venue: 'wharf' }), answer(), answer()]);
    expect((await runToolLoop(input, deps(model))).source).toBe('code');
  });

  it('does not accept a pick made before the final schema turn', async () => {
    const model = fake([
      tool('read_location_evidence', { venue: 'mill' }),
      answer(),
      answer({ ...pick, facts: ['F1', 'F8'] }),
    ]);
    expect((await runToolLoop(input, deps(model))).source).toBe('code');
    expect(model.run).toHaveBeenCalledTimes(3);
    expect(model.requests[2].tools).toBeUndefined();
  });

  it.each([0, 1, 15000000])('uses the visitor budget despite model budget %s', async (budget) => {
    const model = fake([
      tool('read_location_evidence', { venue: 'mill' }),
      tool('propose_stock_allocation', { venue: 'mill', budget }),
      answer(),
      answer(),
    ]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('ai');
    const allocation = JSON.parse(model.requests[2].messages.at(-1)!.content);
    expect(allocation).toEqual({ budget: input.budget, rows: allocate('mill', input.budget) });
    expect(result.steps?.find((s) => s.tool === 'propose_stock_allocation')?.label).toBe(
      'Allocated $900 at Millrace Hall',
    );
    expect(result.steps?.at(-1)?.label).toBe('Code added the venue comparison');
  });

  it('labels the injected comparison step Code added the venue comparison', async () => {
    const model = fake([
      tool('read_location_evidence', { venue: 'mill' }),
      answer(),
      answer(),
    ]);
    const result = await runToolLoop(input, deps(model));
    const step = result.steps?.find((s) => s.tool === 'compare_sites');
    expect(step?.label).toBe('Code added the venue comparison');
  });

  it('keeps reservations when a call throws or usage is absent, including token-only usage', async () => {
    const model = fake([
      {
        ...tool('read_location_evidence', { venue: 'mill' }),
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      },
      { ...answer(), usage: undefined },
      { ...answer(), usage: undefined },
    ]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('ai');
    expect(result.usageUnknown).toBe(true);
    expect(rows()).toEqual([15, 15, 15]);
    const thrown = {
      ...deps(model),
      model: {
        run: vi.fn(async () => {
          throw new Error('timeout');
        }),
      },
    };
    const fallback = await runToolLoop(input, thrown);
    expect(fallback.source).toBe('code');
    expect(fallback.usageUnknown).toBe(true);
    expect(rows().at(-1)).toBe(15);
  });

  it('bounds every turn with maximum budget, live demand at all venues and large counts', async () => {
    const base: Preorder = {
      id: 'live',
      venue: 'mill',
      product: 'tin',
      qty: 3,
      amountCents: 4200,
      state: 'captured',
      source: 'live',
      captureId: 'capture',
      orderId: null,
      refundId: null,
      debugId: null,
      updatedAt: '',
    };
    const evidence: Evidence = {
      budget: 150000,
      preorders: venues.map((v) => ({ ...base, venue: v.id, qty: 999999999 })),
      recorded: venues.map((v) => ({
        ...base,
        venue: v.id,
        source: 'recorded',
        state: 'refunded',
        qty: 999999999,
      })),
    };
    const model = fake([
      tool('read_location_evidence', { venue: 'wharf' }),
      tool('read_location_evidence', { venue: 'mill' }),
      tool('read_location_evidence', { venue: 'linden' }),
      answer({ ...pick, facts: ['F6', 'F10'] }),
    ]);
    const result = await runToolLoop(evidence, deps(model));
    expect(model.requests).toHaveLength(4);
    expect(result.source).toBe('ai');
    expect(model.requests.map((r) => r.messages[0].content)).toEqual(
      Array(4).fill(model.requests[0].messages[0].content),
    );
  });

  it('shortens longest tool texts as JSON without changing rules, ids or money', () => {
    const request: ModelInput = {
      max_tokens: 160,
      tools: loopTools,
      messages: [
        { role: 'system', content: 'System rules stay whole.' },
        {
          role: 'tool',
          tool_call_id: 'call',
          content: JSON.stringify({
            facts: Array.from({ length: 16 }, (_, i) => ({
              id: `F${i + 1}`,
              text: 'Evidence '.repeat(1000),
            })),
            marginCents: 12345,
          }),
        },
      ],
    };
    const bounded = boundTurn(request)!;
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(MAX_TURN_INPUT_CHARS);
    expect(bounded.messages[0]).toEqual(request.messages[0]);
    const result = JSON.parse(bounded.messages[1].content);
    expect(result.marginCents).toBe(12345);
    expect(result.facts.map((f: { id: string }) => f.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `F${i + 1}`),
    );
    expect(result.facts[0].text).toMatch(/\.\.\.$/);
    expect(boundTurn({ ...request, messages: [{ role: 'system', content: 'x'.repeat(3401) }] })).toBeNull();
  });

  it('caches genuine steps with loop: 1 and reads them without another model call', async () => {
    const model = fake([tool('read_location_evidence', { venue: 'mill' }), answer(), answer()]);
    const first = await runAgent(input, deps(model));
    const key = await cacheKey(input);
    const saved = JSON.parse(
      db.sqlite.prepare('SELECT body FROM agent_cache WHERE key=?').get(key)!.body as string,
    );
    expect(saved.loop).toBe(1);
    expect(saved.steps).toEqual(first.steps);
    const second = await runAgent(input, deps(model));
    expect(second.source).toBe('cache');
    expect(second.steps).toEqual(first.steps);
    expect(second).not.toHaveProperty('loop');
    expect(model.run).toHaveBeenCalledTimes(3);
  });

  it('settlement failure retains the ledger row and does not authorize an unpaid call', async () => {
    const failing: Database = {
      prepare(sql) {
        if (sql.startsWith('UPDATE ai_calls')) throw new Error('ledger unavailable');
        return db.prepare(sql);
      },
    };
    const model = fake([tool('read_location_evidence', { venue: 'mill' }), answer(), answer()]);
    const result = await runToolLoop(input, { ...deps(model), ledger: failing });
    expect(result.source).toBe('ai');
    expect(rows()).toEqual([15, 15, 15]);
  });

  it.each([null, [], 'null', '42', '"str"', 'true'])('rejects non-object arguments %j', (value) => {
    expect(toolArguments(value)).toBeNull();
  });

  it('injects comparison on the final turn if the model only read evidence', async () => {
    const model = fake([
      tool('read_location_evidence', { venue: 'wharf' }),
      tool('read_location_evidence', { venue: 'mill' }),
      tool('read_location_evidence', { venue: 'linden' }),
      answer({ ...pick, facts: ['F5', 'F8'] }),
    ]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('ai');
    expect(model.run).toHaveBeenCalledTimes(4);
    expect(rows()).toHaveLength(4);
    expect(result.steps?.at(-1)).toEqual({ tool: 'compare_sites', label: 'Code added the venue comparison' });
    const finalMessages = model.requests.at(-1)!.messages;
    const comparisonMsg = finalMessages.find((m) => m.content.startsWith('Comparison:'));
    expect(comparisonMsg).toBeDefined();
    expect(comparisonMsg?.role).toBe('user');
    expect(comparisonMsg?.content).toBe(
      `Comparison: ${JSON.stringify({
        venues: compare_sites(input).venues.map(({ id, blendedUnits, marginCents }) => ({
          id,
          blendedUnits,
          marginCents,
        })),
      })}`,
    );
  });

  it('does not inject comparison if the model called compare_sites itself', async () => {
    const model = fake([
      tool('read_location_evidence', { venue: 'mill' }),
      tool('compare_sites', {}),
      answer(),
      answer(),
    ]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('ai');
    const finalMessages = model.requests.at(-1)!.messages;
    expect(finalMessages.some((m) => m.content.startsWith('Comparison:'))).toBe(false);
    const compareSteps = result.steps?.filter((s) => s.label === 'Compared the three venues');
    expect(compareSteps).toHaveLength(1);
  });

  it.each([
    { venue: {} },
    { x: 1 },
    'unparseable {',
  ])('compare_sites ignores arguments %j and runs comparison step', async (args) => {
    const model = fake([
      tool('read_location_evidence', { venue: 'mill' }),
      {
        tool_calls: [
          {
            name: 'compare_sites',
            arguments: typeof args === 'string' ? args : JSON.stringify(args),
          },
        ],
        usage: { neurons: 0.74 },
      },
      answer(),
      answer(),
    ]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('ai');
    expect(result.steps).toEqual([
      { tool: 'read_location_evidence', venue: 'mill', label: 'Read Millrace Hall evidence' },
      { tool: 'compare_sites', label: 'Compared the three venues' },
    ]);
  });

  it('second compare_sites call in the same run ends the loop with code answer', async () => {
    const model = fake([
      tool('read_location_evidence', { venue: 'mill' }),
      tool('compare_sites', {}),
      tool('compare_sites', { x: 2 }),
      answer(),
    ]);
    const result = await runToolLoop(input, deps(model));
    expect(result.source).toBe('code');
    expect(result.steps).toEqual([]);
    expect(model.run).toHaveBeenCalledTimes(3);
  });

  it('system message is at most 600 characters and names all three tools', async () => {
    const model = fake([answer(), answer()]);
    await runToolLoop(input, deps(model));
    const system = model.requests[0].messages.find((m) => m.role === 'system')?.content;
    expect(system).toBeDefined();
    expect(system!.length).toBeLessThanOrEqual(600);
    expect(system).toContain('read_location_evidence');
    expect(system).toContain('compare_sites');
    expect(system).toContain('propose_stock_allocation');
  });
});
