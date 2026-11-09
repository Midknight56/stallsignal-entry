import { describe, expect, it } from 'vitest';
import { revealWidget, type RevealTarget } from '../src/studio/reveal';

const target = () => {
  const calls: string[] = [];
  const el: RevealTarget = {
    tabIndex: 0,
    hasAttribute: () => false,
    scrollIntoView: (o) => calls.push(`scroll ${o?.block}`),
    focus: () => calls.push('focus'),
  };
  return { el, calls };
};

describe('bring a new Studio widget into view', () => {
  it('scrolls to the new widget title and moves focus to it', () => {
    const { el, calls } = target();
    expect(revealWidget(() => el, (f) => f())).toBe(true);
    expect(calls).toEqual(['scroll start', 'focus']);
    expect(el.tabIndex).toBe(-1);
  });
  it('waits for the widget to appear, up to 20 frames', () => {
    const { el, calls } = target();
    let looks = 0;
    const queue: (() => void)[] = [];
    revealWidget(() => (++looks >= 5 ? el : null), (f) => queue.push(f));
    while (queue.length) queue.shift()!();
    expect(looks).toBe(5);
    expect(calls).toEqual(['scroll start', 'focus']);
  });
  it('gives up after 20 frames when the widget never appears', () => {
    let looks = 0;
    const queue: (() => void)[] = [];
    revealWidget(() => (looks++, null), (f) => queue.push(f));
    while (queue.length) queue.shift()!();
    expect(looks).toBe(21);
  });
});
