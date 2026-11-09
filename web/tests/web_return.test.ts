import { expect, it, vi } from 'vitest';
const route = vi.hoisted(() => vi.fn(async () => ({ preorder: { id: 'one', state: 'captured' } })));
vi.mock('../src/api', () => ({ returnPreorder: route }));
import { returnOnce } from '../src/returnOnce';
it('shares one route call across effect replay and remounts', async () => {
  const first = returnOnce('one', false);
  const second = returnOnce('one', false);
  expect(first).toBe(second);
  await Promise.all([first, second]);
  expect(route).toHaveBeenCalledTimes(1);
});
it('forwards buyer cancellation once', async () => {
  await Promise.all([returnOnce('two', true), returnOnce('two', true)]);
  expect(route).toHaveBeenLastCalledWith('two', true);
  expect(route.mock.calls.filter((c) => (c as unknown[])[0] === 'two')).toHaveLength(1);
});
