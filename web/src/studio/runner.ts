import type { AgAiChatSession, AgAiEvent, AgAiRunInput } from 'ag-studio';
import { widgetKinds, type WidgetKind } from '../../../src/agent/ask';
import type { VenueId } from '../../../src/shared/types';
import type { Selection, View } from './filter';

const views: readonly View[] = [
  'overestimated',
  'underestimated',
  'by_venue',
  'refunds_open',
  'paid_vs_forecast',
];
export type AskChange = Selection & {
  source: 'ai' | 'matched' | 'recorded';
  add?: WidgetKind | null;
  title?: string;
};

export function askToChange(value: unknown): AskChange | null {
  if (!value || typeof value !== 'object') return null;
  const reply = value as Record<string, unknown>;
  if (
    !views.includes(reply.view as View) ||
    ![null, 'wharf', 'mill', 'linden'].includes(reply.venue as VenueId | null) ||
    !['ai', 'matched', 'recorded'].includes(reply.source as string)
  )
    return null;
  const hasAdd = 'add' in reply;
  const add = !hasAdd
    ? undefined
    : reply.add === null
      ? null
      : widgetKinds.includes(reply.add as WidgetKind)
        ? (reply.add as WidgetKind)
        : null;
  const title = typeof reply.title === 'string' ? reply.title : undefined;
  return {
    view: reply.view as View,
    venue: reply.venue as VenueId | null,
    source: reply.source as AskChange['source'],
    ...(hasAdd ? { add } : {}),
    ...(title ? { title } : {}),
  };
}
export const answerSource = (source: AskChange['source']) =>
  ({ ai: 'AI', matched: 'Matched without AI', recorded: 'Recorded' })[source];
export function answerText(change: AskChange) {
  if (change.add) {
    return {
      refunds_by_venue: 'Added a chart of refunds by venue.',
      paid_by_venue: 'Added a chart of paid units by venue.',
      preorders_by_state: 'Added a chart of preorders by state.',
      pending_payments: 'Added a table of pending payments.',
    }[change.add];
  }
  const view = {
    overestimated: 'Showing forecasts that overestimated demand.',
    underestimated: 'Showing forecasts that underestimated demand.',
    by_venue: 'Showing evidence by venue.',
    refunds_open: 'Showing open refunds and their states.',
    paid_vs_forecast:
      'Comparing live paid units, recorded paid units and forecast units. Forecasts use synthetic history.',
  }[change.view];
  const venue = change.venue
    ? { wharf: 'Shed 9 at the Wharf', mill: 'Millrace Hall', linden: 'Linden Corner Shop' }[change.venue]
    : 'All venues';
  return `${view} ${venue}.`;
}
export const latestUserText = (input: AgAiRunInput) => {
  const message = [...input.messages].reverse().find((m) => m.role === 'user');
  return message && typeof message.content === 'string' ? message.content.trim().slice(0, 200) : '';
};
export const shouldFinish = (input: AgAiRunInput) => input.messages.at(-1)?.role === 'tool';
export function changeEvents(change: AskChange, runId: string): AgAiEvent[] {
  return [
    { type: 'TOOL_CALL_START', toolCallId: `change-${runId}`, toolCallName: 'set_dashboard_view' },
    { type: 'TOOL_CALL_ARGS', toolCallId: `change-${runId}`, delta: JSON.stringify(change) },
    { type: 'TOOL_CALL_END', toolCallId: `change-${runId}` },
  ];
}
export function addWidgetEvents(kind: WidgetKind, title: string, runId: string): AgAiEvent[] {
  return [
    { type: 'TOOL_CALL_START', toolCallId: `add-${runId}`, toolCallName: 'add_widget' },
    { type: 'TOOL_CALL_ARGS', toolCallId: `add-${runId}`, delta: JSON.stringify({ kind, title }) },
    { type: 'TOOL_CALL_END', toolCallId: `add-${runId}` },
  ];
}

export function sendQuestion(session: AgAiChatSession, q: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let started = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.removeEventListener('changed', changed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (session.status === 'running') started = true;
      if (session.status === 'error') {
        const part = session.messages.flatMap((m) => m.parts).find((p) => p.type === 'error');
        finish(new Error(part?.type === 'error' ? part.message : 'The dashboard request failed.'));
      } else if (started && session.status === 'idle') finish();
    };
    const timer = setTimeout(() => {
      finish(new Error('The request took too long. Please try again.'));
      session.cancel();
    }, 45000);
    session.addEventListener('changed', changed);
    try {
      session.sendMessage(q);
      changed();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Request failed.'));
    }
  });
}
