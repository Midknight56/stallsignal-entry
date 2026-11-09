import { returnPreorder } from './api';
import type { Preorder } from '../../src/shared/types';
const returns = new Map<string, Promise<{ preorder: Preorder }>>();
// Module scope survives StrictMode's effect replay and route remounts.
export function returnOnce(id: string, cancel: boolean) {
  const key = `${id}:${cancel}`;
  let pending = returns.get(key);
  if (!pending) {
    pending = returnPreorder(id, cancel);
    returns.set(key, pending);
  }
  return pending;
}
