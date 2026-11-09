import portland from './portland.json' with { type: 'json' };

export type Point = readonly number[];
export const city = {
  name: portland.name,
  label: portland.label,
  viewBox: portland.viewBox,
  water: portland.water,
  roads: portland.roads,
  labels: portland.labels,
};

export function inPolygon(x: number, y: number, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const dx = xi - xj;
    const dy = yi - yj;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - xj) * dx + (y - yj) * dy) / (dx * dx + dy * dy))) : 0;
    if (Math.hypot(x - xj - t * dx, y - yj - t * dy) < 1e-7) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function onLand(x: number, y: number): boolean {
  return (
    x >= 0 &&
    y >= 0 &&
    x <= 1000 &&
    y <= 700 &&
    !city.water.some((feature) => feature.rings.some((ring) => inPolygon(x, y, ring)))
  );
}
