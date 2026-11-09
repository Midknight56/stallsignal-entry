export type SheetHeight = 'low' | 'middle' | 'high';
export const sheetHeights: SheetHeight[] = ['low', 'middle', 'high'];
export function nextSheetHeight(current: SheetHeight, delta: number): SheetHeight {
  const i = sheetHeights.indexOf(current);
  return sheetHeights[Math.max(0, Math.min(2, i + (delta < -35 ? 1 : delta > 35 ? -1 : 0)))];
}
export const clampSplit = (value: number) => Math.min(95, Math.max(5, value));
export const splitFromPointer = (x: number, left: number, width: number) =>
  clampSplit(((x - left) / Math.max(1, width)) * 100);
