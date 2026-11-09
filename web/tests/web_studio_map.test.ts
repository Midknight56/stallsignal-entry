import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { customWidgets, DashboardContext } from '../src/studio/widgets';
import { freshCampaign, scorecard, world } from '../src/mock/fixtures';
import { shapeTables } from '../src/studio/data';

describe('Studio map widget credit', () => {
  it('contains the Census Bureau short line credit', () => {
    const tables = shapeTables(world, freshCampaign(), scorecard());
    const mapWidgetDef = (customWidgets as any).widgets.find(
      (w: any) => w.id === 'portland-map',
    );
    expect(mapWidgetDef).toBeDefined();
    const MapComp = mapWidgetDef.comp;
    const markup = renderToStaticMarkup(
      createElement(
        DashboardContext.Provider,
        {
          value: {
            world,
            campaign: freshCampaign(),
            tables,
            selection: { venue: 'mill' },
            selectVenue: () => {},
          },
        },
        createElement(MapComp),
      ),
    );
    expect(markup).toContain('Map data: U.S. Census Bureau (TIGER/Line 2025, LODES 8.5).');
  });
});
