import { MAX_INPUT_CHARS, MAX_OUTPUT_TOKENS, MODEL_ID, MODEL_ENABLED } from '../caps';
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}
export interface ModelInput {
  messages: Message[];
  max_tokens: number;
  response_format?: { type: 'json_schema'; json_schema: object };
  tools?: ToolDefinition[];
}
export interface Model {
  run(model: typeof MODEL_ID, input: ModelInput): Promise<unknown>;
}
export function boundMessages(messages: Message[]): Message[] {
  let left =
    MAX_INPUT_CHARS - messages.filter((m) => m.role === 'system').reduce((n, m) => n + m.content.length, 0);
  if (left < 0) throw new Error('System rules exceed the input bound');
  return messages.map((m) => {
    if (m.role === 'system') return m;
    const lines: string[] = [];
    for (const line of m.content.split('\n')) {
      const size = line.length + (lines.length ? 1 : 0);
      if (size > left) break;
      lines.push(line);
      left -= size;
    }
    return { ...m, content: lines.join('\n') };
  });
}
export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function toolArguments(value: unknown): Record<string, unknown> | null {
  try {
    for (let i = 0; i < 2 && typeof value === 'string'; i++) value = JSON.parse(value);
    return object(value);
  } catch {
    return null;
  }
}
// Normalize both the REST chat response and the Workers binding response.
export async function callTurn(model: Model, input: ModelInput) {
  if (!MODEL_ENABLED) throw new Error('Configured model is deprecated');
  const raw = object(await model.run(MODEL_ID, input));
  const choices = raw?.choices;
  const choice = Array.isArray(choices) ? object(choices[0]) : null;
  const message = object(choice?.message);
  const content = message?.content ?? raw?.response;
  const usage = object(raw?.usage);
  const neurons = usage?.neurons;
  const used = typeof neurons === 'number' && Number.isFinite(neurons) && neurons >= 0 ? neurons : null;
  const calls = message?.tool_calls ?? raw?.tool_calls;
  const toolCalls: ToolCall[] = [];
  let valid = !!raw && choice?.finish_reason !== 'length' && raw.finish_reason !== 'length';
  if (calls !== undefined) {
    if (!Array.isArray(calls)) valid = false;
    else
      for (const [i, value] of calls.entries()) {
        const call = object(value);
        const fn = object(call?.function) ?? call;
        // compare_sites takes no arguments, so arguments that do not parse are ignored for it.
        const args = toolArguments(fn?.arguments) ?? (fn?.name === 'compare_sites' ? {} : null);
        const id = call?.id ?? `call_${input.messages.filter((m) => m.role === 'assistant').length}_${i}`;
        if (
          !args ||
          typeof fn?.name !== 'string' ||
          typeof id !== 'string' ||
          !id ||
          (call?.type !== undefined && call.type !== 'function')
        ) {
          valid = false;
          break;
        }
        toolCalls.push({
          id,
          type: 'function',
          function: { name: fn.name, arguments: JSON.stringify(args) },
        });
      }
  }
  if (choice?.finish_reason === 'tool_calls' && !toolCalls.length) valid = false;
  return { valid, toolCalls, used, answer: typeof content === 'string' ? parseAnswer(content) : null };
}
export function parseAnswer(text: string): Record<string, unknown> | null {
  try {
    return object(
      JSON.parse(
        text
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, ''),
      ),
    );
  } catch {
    return null;
  }
}
export function factId(value: unknown): string | null {
  return typeof value === 'string' ? (value.match(/^(F\d+)(?=\s|$|:)/)?.[1] ?? null) : null;
}
export async function callModel(model: Model, messages: Message[], schema: object) {
  if (!MODEL_ENABLED) throw new Error('Configured model is deprecated');
  const raw = object(
    await model.run(MODEL_ID, {
      messages: boundMessages(messages),
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: 'json_schema', json_schema: schema },
    }),
  );
  const usage = object(raw?.usage);
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const used = valid(usage?.neurons)
    ? usage.neurons
    : valid(usage?.prompt_tokens) && valid(usage?.completion_tokens)
      ? Math.ceil((usage.prompt_tokens * 1542 + usage.completion_tokens * 10158) / 10000) / 100
      : null;
  const choices = raw?.choices;
  const choice = Array.isArray(choices) ? object(choices[0]) : null;
  const content = object(choice?.message)?.content;
  const text = typeof content === 'string' ? content : typeof raw?.response === 'string' ? raw.response : '';
  return { answer: choice?.finish_reason === 'length' ? null : parseAnswer(text), used };
}
