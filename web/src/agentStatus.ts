import { sourceLabel } from './format';
import type { AgentView } from '../../src/shared/types';

export type AgentSource = AgentView['source'];
export function isAgentSource(value: unknown): value is AgentSource {
  return ['ai', 'cache', 'recorded', 'code'].includes(value as string);
}
export function agentStatus(source: AgentSource | null, available = false): string {
  if (!source) return available ? 'Agent ready' : 'Recorded run';
  return { ai: 'Live AI', cache: sourceLabel('cache'), recorded: 'Recorded run', code: 'Code pick' }[source];
}
export function lastAgentSource(): AgentSource | null {
  try {
    const source = sessionStorage.getItem('stallsignal.agentSource');
    return isAgentSource(source) ? source : null;
  } catch {
    return null;
  }
}
export function rememberAgentSource(source: AgentSource) {
  try {
    sessionStorage.setItem('stallsignal.agentSource', source);
  } catch {
    /* The current page still tracks the answer when storage is blocked. */
  }
}
