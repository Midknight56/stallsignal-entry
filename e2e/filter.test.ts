import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./helpers.ts', import.meta.url), 'utf8');
const match = source.match(/export function isAgStudioTrialBoxLine\(message: string\) \{([\s\S]*?)\n\}/);
assert.ok(match, 'filter function exists in helpers.ts');
const isAgStudioTrialBoxLine = new Function('message', match[1]!) as (message: string) => boolean;

for (const line of [
  '******** AG Studio Pro with AI License ********',
  '******** License Key Not Found ********',
  '* All AG Studio Pro with AI features are unlocked for trial.        *',
  '* If you want to hide the watermark please email support@example.com *',
  '********',
  '********************',
]) {
  assert.equal(isAgStudioTrialBoxLine(line), true, line);
}
assert.equal(isAgStudioTrialBoxLine('Unrelated console error'), false);
assert.equal(isAgStudioTrialBoxLine('******** unrelated ********'), false);
