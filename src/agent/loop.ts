import { MAX_OUTPUT_TOKENS, MAX_TURN_INPUT_CHARS, MODEL_ENABLED, RESERVE_PER_CALL } from '../caps';
import { venues } from '../data/venues';
import type { AgentView } from '../shared/types';
import { codeAnswer, pickSchema } from './answer';
import { makeFacts, type Evidence, type Fact } from './facts';
import { appLeft, keep, reserve, settle } from './ledger';
import { callTurn, factId, toolArguments, type Message, type ModelInput, type ToolDefinition } from './model';
import type { RunDeps } from './run';
import { compare_sites, propose_stock_allocation, read_location_evidence } from './tools';

import { MAX_TURNS } from '../caps';
export { MAX_TURNS };

export const loopTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_location_evidence',
      description: 'Read the numbered facts for one venue.',
      parameters: {
        type: 'object',
        properties: { venue: { type: 'string', enum: venues.map((v) => v.id) } },
        required: ['venue'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_sites',
      description:
        "Today's evidence for all three venues: forecast blended with paid preorders, as units and expected margin in cents. Call this before you pick.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_stock_allocation',
      description: 'Stock to buy at the venue you pick, within the visitor budget.',
      parameters: {
        type: 'object',
        properties: {
          venue: { type: 'string', enum: venues.map((v) => v.id) },
          budget: { type: 'integer', minimum: 0 },
        },
        required: ['venue', 'budget'],
        additionalProperties: false,
      },
    },
  },
];

// Shrink only fact text from tool results. JSON, ids, amounts, system rules and
// assistant/tool call pairs stay intact. If metadata alone is too big, fail closed.
export function boundTurn(input: ModelInput): ModelInput | null {
  const size = (value: ModelInput) => JSON.stringify(value).length;
  if (size(input) <= MAX_TURN_INPUT_CHARS) return input;
  function shortened(limit: number): ModelInput {
    return {
      ...input,
      messages: input.messages.map((message) => {
        if (message.role !== 'tool') return message;
        const result = JSON.parse(message.content);
        return {
          ...message,
          content: JSON.stringify(result, (key, value) =>
            key === 'text' && typeof value === 'string' && value.length > limit
              ? value.slice(0, limit) + '...'
              : value,
          ),
        };
      }),
    };
  }
  // Every retained fact includes readable text as well as its id.
  let low = 24,
    high = MAX_TURN_INPUT_CHARS;
  let best = shortened(low);
  if (size(best) > MAX_TURN_INPUT_CHARS) return null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = shortened(middle);
    if (size(candidate) <= MAX_TURN_INPUT_CHARS) {
      best = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  return best;
}

function comparePayload(input: Evidence) {
  return {
    venues: compare_sites(input).venues.map(({ id, blendedUnits, marginCents }) => ({
      id,
      blendedUnits,
      marginCents,
    })),
  };
}

export async function runToolLoop(input: Evidence, deps: RunDeps): Promise<AgentView> {
  const fallback = codeAnswer(input);
  const steps: NonNullable<AgentView['steps']> = [];
  const read = new Set<string>();
  const seen = new Set<string>();
  const at = new Date(deps.now ?? Date.now()).toISOString();
  const day = at.slice(0, 10);
  let reserved = 0,
    used = 0,
    usageUnknown = false,
    reservationRefused = false,
    compared = false;
  let result = fallback;
  const messages: Message[] = [
    {
      role: 'system',
      content:
        'Follow this order: call read_location_evidence to read evidence, call compare_sites, call propose_stock_allocation for the venue you will pick, then answer. Paid preorders are stronger evidence than the forecast. The pick needs a reason from the facts if it is not the venue with the highest expected margin. Select a venue with positive expected margin and 2 to 4 distinct fact ids you read, including one about your pick. Return JSON with pick, facts and risk (low, medium or high). The visitor budget always applies.',
    },
    {
      role: 'user',
      content: `Stock budget cents: ${input.budget}. Venues: ${venues.map((v) => `${v.id}: ${v.name}`).join('; ')}.`,
    },
  ];
  let final = false;
  try {
    if (!deps.model || !deps.ledger || !MODEL_ENABLED)
      return { ...fallback, fallback: 'model_off', budgetCents: input.budget };
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      final ||= turn === MAX_TURNS - 1;
      if (final && !compared) {
        compared = true;
        const payload = JSON.stringify(comparePayload(input));
        messages.push({ role: 'user', content: `Comparison: ${payload}` });
        steps.push({ tool: 'compare_sites', label: 'Code added the venue comparison' });
      }
      const request = boundTurn({
        messages,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(final
          ? { response_format: { type: 'json_schema' as const, json_schema: pickSchema } }
          : { tools: loopTools }),
      });
      if (!request) break;
      const id = await reserve(deps.ledger, day, at);
      if (id === null) {
        reservationRefused = true;
        break;
      }
      reserved += RESERVE_PER_CALL;
      let response;
      try {
        response = await callTurn(deps.model, request);
      } catch {
        keep(id);
        usageUnknown = true;
        break;
      }
      if (response.used === null) {
        keep(id);
        usageUnknown = true;
      } else {
        await settle(deps.ledger, id, response.used);
        used += response.used;
      }
      if (!response.valid) break;
      if (final) {
        if (response.toolCalls.length) break;
        const answer = response.answer;
        const facts = makeFacts(input);
        const selected = Array.isArray(answer?.facts)
          ? answer.facts.map(factId).map((id) => facts.find((f) => f.id === id))
          : [];
        const row = compare_sites(input).venues.find((v) => v.id === answer?.pick);
        const risk = answer?.risk;
        if (
          row &&
          row.marginCents > 0 &&
          selected.length >= 2 &&
          selected.length <= 4 &&
          selected.every((f): f is Fact => !!f && read.has(f.id)) &&
          new Set(selected.map((f) => f.id)).size === selected.length &&
          selected.some((f) => f.venue === row.id) &&
          (risk === 'low' || risk === 'medium' || risk === 'high')
        ) {
          result = { ...codeAnswer(input, row.id, selected, risk), source: 'ai', label: 'Live AI' };
        }
        break;
      }
      if (!response.toolCalls.length) {
        final = true;
        continue;
      }
      messages.push({ role: 'assistant', content: '', tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        const name = call.function.name;
        const isRead = name === 'read_location_evidence';
        const isAllocation = name === 'propose_stock_allocation';
        if (name !== 'compare_sites' && !isRead && !isAllocation) throw new Error('Unknown tool');
        const args = toolArguments(call.function.arguments);
        const venue = args ? venues.find((v) => v.id === args.venue) : undefined;
        const keys = args ? Object.keys(args) : [];
        if (
          name === 'compare_sites'
            ? false
            : !args ||
              !venue ||
              keys.some((k) => !['venue', ...(isAllocation ? ['budget'] : [])].includes(k)) ||
              (isAllocation &&
                (typeof args.budget !== 'number' || !Number.isSafeInteger(args.budget) || args.budget < 0))
        )
          throw new Error('Invalid tool arguments');
        // Identity uses the effective budget so changing a model budget cannot bypass repetition checks.
        const signature = JSON.stringify([name, venue?.id, isAllocation ? input.budget : null]);
        if (seen.has(signature)) throw new Error('Repeated tool call');
        seen.add(signature);
        let output: unknown;
        if (isRead) {
          const facts = read_location_evidence(venue!.id, input);
          facts.forEach((f) => read.add(f.id));
          output = { facts: facts.map(({ id, text }) => ({ id, text })) };
          steps.push({ tool: name, venue: venue!.id, label: `Read ${venue!.name} evidence` });
        } else if (isAllocation) {
          output = { budget: input.budget, rows: propose_stock_allocation(venue!.id, input.budget) };
          const money = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 2,
            minimumFractionDigits: 0,
          }).format(input.budget / 100);
          steps.push({ tool: name, venue: venue!.id, label: `Allocated ${money} at ${venue!.name}` });
        } else {
          compared = true;
          output = comparePayload(input);
          steps.push({ tool: name, label: 'Compared the three venues' });
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }
  } catch {
    // Invalid calls and answers use the code pick without model steps.
  }
  // J34 explicitly retains completed steps on reservation refusal. Other code
  // answers have no steps; the panel only displays steps for live answers.
  if (result.source !== 'ai') {
    result.fallback = reservationRefused ? 'daily_budget' : 'check_failed';
  } else {
    delete result.fallback;
  }
  result.budgetCents = input.budget;
  result.steps = result.source === 'ai' || reservationRefused ? steps : [];
  result.neurons = { reserved, used, appLeft: await appLeft(deps.ledger, day) };
  if (usageUnknown) result.usageUnknown = true;
  return result;
}
