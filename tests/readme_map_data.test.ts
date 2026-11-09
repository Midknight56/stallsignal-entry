import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('README.md Map data section', () => {
  it('contains the trademark sentence and the LODES citation', () => {
    const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');
    expect(readme).toContain('## Map data');
    expect(readme).toContain('TIGER/Line is a registered trademark of the U.S. Census Bureau.');
    expect(readme).toContain(
      'Daytime workers: U.S. Census Bureau, "me_wac_S000_JT00_2024," LEHD Origin Destination Employment Statistics, 8.5, https://lehd.ces.census.gov/data/lodes, accessed on November 8, 2026.',
    );
  });
});
