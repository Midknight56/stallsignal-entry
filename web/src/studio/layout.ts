import { EVIDENCE_ROW_HEIGHT } from './evidence';
import { chartWidget } from './filter';

export const MAX_SPAN = 88;

export function widgetLayout(
  compact: boolean,
  evidenceRows = 23,
  preorderRows = 9,
  existingWidgets?: Record<string, unknown>,
) {
  // Bounded: a long campaign scrolls inside the widget instead of making the page very long (88 tracks = 704 px).
  const evidenceSpan = Math.min(MAX_SPAN, Math.ceil((evidenceRows * EVIDENCE_ROW_HEIGHT + 130) / 8));
  const refundSpan = Math.min(MAX_SPAN, Math.ceil((260 + preorderRows * 100) / 8));
  const base = compact
    ? {
        map: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 44 },
        evidence: { xTrack: 0, yTrack: 44, xSpan: 12, ySpan: evidenceSpan },
        errors: { xTrack: 0, yTrack: 44 + evidenceSpan, xSpan: 12, ySpan: 64 },
        refunds: { xTrack: 0, yTrack: 108 + evidenceSpan, xSpan: 12, ySpan: refundSpan },
      }
    : {
        map: { xTrack: 0, yTrack: 0, xSpan: 7, ySpan: 88 },
        evidence: { xTrack: 7, yTrack: 0, xSpan: 5, ySpan: evidenceSpan },
        errors: { xTrack: 0, yTrack: 88, xSpan: 7, ySpan: 64 },
        refunds: { xTrack: 7, yTrack: evidenceSpan, xSpan: 5, ySpan: refundSpan },
      };
  if (!existingWidgets) return base;
  const addedIds = Object.keys(existingWidgets).filter(
    (id) => !['map', 'evidence', 'errors', 'refunds'].includes(id),
  );
  if (!addedIds.length) return base;
  const baseBottom = Math.max(...Object.values(base).map((l) => l.yTrack + l.ySpan));
  const full: Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }> = { ...base };
  addedIds.forEach((id, index) => {
    full[id] = { xTrack: 0, yTrack: baseBottom + index * 44, xSpan: 12, ySpan: 44 };
  });
  return full;
}

export function createInitialLayout(compact: boolean, dark = false) {
  return {
    panels: {
      ai: { collapsed: true },
      edit: { collapsed: true },
      data: { collapsed: true },
      filters: { collapsed: true },
    },
    selectedPageId: 'portland',
    pages: [
      {
        id: 'portland',
        widgets: {
          map: {
            type: 'portland-map',
            dataMapping: {},
            format: { title: { enabled: true, text: 'Portland, Maine' } },
          },
          evidence: {
            type: 'grid',
            dataMapping: {
              cols: ['venue', 'kind', 'label', 'value', 'source'].map((id) => ({ id: `evidence.${id}` })),
            },
            format: {
              title: { enabled: true, text: 'Evidence' },
              crossFilter: 'filter',
              style: { columnAutoSize: true },
            },
          },
          errors: chartWidget('by_venue', dark),
          refunds: {
            type: 'refund-liability',
            dataMapping: {},
            format: { title: { enabled: true, text: 'Refund liability' } },
          },
        },
        widgetLayout: widgetLayout(compact),
      },
    ],
  };
}
