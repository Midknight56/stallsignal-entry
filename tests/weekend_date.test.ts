import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { draft_preorder_campaign } from '../src/agent/tools';
import { venues } from '../src/data/venues';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return nested.flat();
}

describe('popup weekend dates', () => {
  it('uses 19 Dec in offer terms and removes the old dates from source', async () => {
    const offer = draft_preorder_campaign(venues[0].id);
    expect(offer.terms).toContain('Pickup Sat 19 Dec.');

    const files = await Promise.all(
      [...(await sourceFiles('src')), ...(await sourceFiles('web/src'))].map(async (path) => ({
        path,
        contents: await readFile(path, 'utf8'),
      })),
    );
    const stale = files
      .filter(({ contents }) => /12 Dec|13 Dec/.test(contents))
      .map(({ path }) => path);
    expect(stale).toEqual([]);
  });
});
