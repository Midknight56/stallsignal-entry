import { describe, it, expect } from 'vitest';
import { clampSplit, nextSheetHeight, splitFromPointer } from '../src/layout';
describe('phone gestures and comparison', () => {
  it('keeps the comparison within reach', () => {
    expect(clampSplit(-10)).toBe(5);
    expect(clampSplit(110)).toBe(95);
    expect(splitFromPointer(195, 0, 390)).toBe(50);
  });
  it('moves one sheet height for a drag and clamps the ends', () => {
    expect(nextSheetHeight('middle', -100)).toBe('high');
    expect(nextSheetHeight('middle', 100)).toBe('low');
    expect(nextSheetHeight('low', 100)).toBe('low');
    expect(nextSheetHeight('high', -100)).toBe('high');
    expect(nextSheetHeight('middle', 8)).toBe('middle');
  });
});
