import type { AgFilterState, AgStudioApi } from 'ag-studio';
import type { WidgetKind } from '../../../src/agent/ask';

export const BASE_WIDGET_IDS = ['map', 'evidence', 'errors', 'refunds'] as const;
export const isBaseWidget = (id: string) => (BASE_WIDGET_IDS as readonly string[]).includes(id);

export function sanitizeTitle(title: unknown): string {
  if (typeof title !== 'string') return 'Chart';
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 60 || !/^[A-Za-z0-9 ]+$/.test(trimmed)) {
    return 'Chart';
  }
  return trimmed;
}

export function defaultTitleFor(kind: WidgetKind): string {
  return {
    refunds_by_venue: 'Refunds by venue',
    paid_by_venue: 'Paid by venue',
    preorders_by_state: 'Preorders by state',
    pending_payments: 'Pending payments',
  }[kind];
}

export function kindLabel(kind: WidgetKind): string {
  return {
    refunds_by_venue: 'chart of refunds by venue',
    paid_by_venue: 'chart of paid units by venue',
    preorders_by_state: 'chart of preorders by state',
    pending_payments: 'table of pending payments',
  }[kind];
}

export function buildWidget(kind: WidgetKind, title: string, dark = false) {
  const color = dark ? '#EEE7DA' : '#12263A';
  if (kind === 'refunds_by_venue') {
    return {
      widget: {
        type: 'bar-chart-grouped' as const,
        dataMapping: {
          categoryKey: [{ id: 'preorders.venue' }],
          valueKey: [{ id: 'preorders.id', aggregation: 'count' as const }],
        },
        format: {
          title: { enabled: true, text: title },
          style: {
            theme: { common: { legend: { enabled: true, position: 'bottom' as const } } },
            custom: {
              valueAxis: {
                title: { enabled: true, text: 'Refund count', color },
                label: { color },
              },
              categoryAxis: { label: { fontSize: 11, color, avoidCollisions: false } },
            },
          },
        },
      },
      filter: [
        {
          field: { id: 'preorders.refund' },
          model: { operator: 'isTrue' as const },
        },
      ] as AgFilterState[],
    };
  }
  if (kind === 'paid_by_venue') {
    return {
      widget: {
        type: 'bar-chart-grouped' as const,
        dataMapping: {
          categoryKey: [{ id: 'venues.venue' }],
          valueKey: [{ id: 'venues.paidUnits', aggregation: 'sum' as const }],
        },
        format: {
          title: { enabled: true, text: title },
          style: {
            theme: { common: { legend: { enabled: true, position: 'bottom' as const } } },
            custom: {
              valueAxis: {
                title: { enabled: true, text: 'Paid units', color },
                label: { color },
              },
              categoryAxis: { label: { fontSize: 11, color, avoidCollisions: false } },
            },
          },
        },
      },
      filter: undefined,
    };
  }
  if (kind === 'preorders_by_state') {
    return {
      widget: {
        type: 'pie-chart' as const,
        dataMapping: {
          categoryKey: [{ id: 'preorders.state' }],
          valueKey: [{ id: 'preorders.id', aggregation: 'count' as const }],
        },
        format: {
          title: { enabled: true, text: title },
          style: {
            theme: { common: { legend: { enabled: true, position: 'bottom' as const } } },
          },
        },
      },
      filter: undefined,
    };
  }
  return {
    widget: {
      type: 'grid' as const,
      dataMapping: {
        cols: [
          { id: 'preorders.venue' },
          { id: 'preorders.state' },
          { id: 'preorders.amount' },
          { id: 'preorders.orderId' },
        ],
      },
      format: {
        title: { enabled: true, text: title },
        style: { columnAutoSize: true },
      },
    },
    filter: [
      {
        field: { id: 'preorders.unsettled' },
        model: { operator: 'isTrue' as const },
      },
    ] as AgFilterState[],
  };
}

export function getAddedWidgetIds(page: { widgets?: Record<string, unknown> }): string[] {
  return Object.keys(page.widgets ?? {}).filter((id) => !isBaseWidget(id));
}

let widgetCounter = 0;

export function addWidgetTo(
  api: Pick<AgStudioApi, 'getState' | 'setState'>,
  kind: WidgetKind,
  title: string,
  dark = false,
  _compact = false,
): boolean {
  const state = api.getState();
  const page = state.pages.find((entry) => entry.id === state.selectedPageId) ?? state.pages[0];
  if (!page) return false;

  const existingAdded = getAddedWidgetIds(page);
  const nextWidgets = { ...page.widgets };
  const nextLayout = { ...page.widgetLayout };
  const nextFilter = { ...page.filter, widget: { ...page.filter?.widget } };

  if (existingAdded.length >= 4) {
    const oldestId = existingAdded[0];
    delete nextWidgets[oldestId];
    delete nextLayout[oldestId];
    if (nextFilter.widget) delete nextFilter.widget[oldestId];
  }

  const timestamp = Date.now();
  widgetCounter += 1;
  let newWidgetId = `added-${timestamp}-${widgetCounter}`;
  while (nextWidgets[newWidgetId]) {
    widgetCounter += 1;
    newWidgetId = `added-${timestamp}-${widgetCounter}`;
  }

  const { widget, filter } = buildWidget(kind, title, dark);
  nextWidgets[newWidgetId] = widget as never;
  if (filter && nextFilter.widget) {
    nextFilter.widget[newWidgetId] = filter;
  }

  const remainingAdded = Object.keys(nextWidgets).filter((id) => !isBaseWidget(id));
  const baseBottom = Math.max(
    0,
    ...Object.entries(nextLayout)
      .filter(([id]) => isBaseWidget(id))
      .flatMap(([, layout]) => (layout ? [layout.yTrack + layout.ySpan] : [])),
  );

  remainingAdded.forEach((id, index) => {
    nextLayout[id] = { xTrack: 0, yTrack: baseBottom + index * 44, xSpan: 12, ySpan: 44 };
  });

  const nextPage = {
    ...page,
    widgets: nextWidgets,
    widgetLayout: nextLayout,
    filter: nextFilter,
  };

  api.setState({
    ...state,
    pages: state.pages.map((entry) => (entry.id === page.id ? nextPage : entry)),
  });

  const updatedPage = api.getState().pages.find((entry) => entry.id === page.id);
  return Boolean(updatedPage?.widgets?.[newWidgetId]);
}

export function removeAddedWidgetsFrom(api: Pick<AgStudioApi, 'getState' | 'setState'>): boolean {
  const state = api.getState();
  const page = state.pages.find((entry) => entry.id === state.selectedPageId) ?? state.pages[0];
  if (!page) return false;

  const addedIds = getAddedWidgetIds(page);
  if (!addedIds.length) return true;

  const nextWidgets = { ...page.widgets };
  const nextLayout = { ...page.widgetLayout };
  const nextFilterWidget = { ...page.filter?.widget };

  for (const id of addedIds) {
    delete nextWidgets[id];
    delete nextLayout[id];
    delete nextFilterWidget[id];
  }

  const nextPage = {
    ...page,
    widgets: nextWidgets,
    widgetLayout: nextLayout,
    filter: { ...page.filter, widget: nextFilterWidget },
  };

  api.setState({
    ...state,
    pages: state.pages.map((entry) => (entry.id === page.id ? nextPage : entry)),
  });

  const updatedPage = api.getState().pages.find((entry) => entry.id === page.id);
  return getAddedWidgetIds(updatedPage ?? {}).length === 0;
}
