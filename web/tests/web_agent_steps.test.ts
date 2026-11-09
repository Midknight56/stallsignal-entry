import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AgentSteps, default as AgentPanel } from '../src/panel/AgentPanel';
import { freshCampaign, mockAgent, world } from '../src/mock/fixtures';

it('shows three mock steps in order for live and cached answers with steps', () => {
  const answer = mockAgent(90000, freshCampaign());
  const expectedHtml =
    '<section class="agent-steps" aria-label="Agent steps"><h4>Steps it took</h4><ol><li>Read Millrace Hall evidence</li><li>Compared the three venues</li><li>Allocated $900 at Millrace Hall</li></ol></section>';
  expect(renderToStaticMarkup(createElement(AgentSteps, { answer }))).toBe(expectedHtml);
  expect(renderToStaticMarkup(createElement(AgentSteps, { answer: { ...answer, source: 'cache' } }))).toBe(
    expectedHtml,
  );
  expect(
    renderToStaticMarkup(createElement(AgentSteps, { answer: { ...answer, source: 'cache', steps: [] } })),
  ).toBe('');
  expect(
    renderToStaticMarkup(
      createElement(AgentSteps, { answer: { ...answer, source: 'cache', steps: undefined } }),
    ),
  ).toBe('');
  for (const source of ['recorded', 'code'] as const)
    expect(renderToStaticMarkup(createElement(AgentSteps, { answer: { ...answer, source } }))).toBe('');
  for (const steps of [[], undefined])
    expect(renderToStaticMarkup(createElement(AgentSteps, { answer: { ...answer, steps } }))).toBe('');
});

it('shows neurons used, reserved, and left today rounded to whole numbers without decimal points', () => {
  const answer = mockAgent(90000, freshCampaign());
  const fractionalAnswer = {
    ...answer,
    neurons: {
      used: 4.918158650398254,
      reserved: 60,
      appLeft: 843.5441185832024,
    },
  };
  const html = renderToStaticMarkup(
    createElement(AgentPanel, {
      world,
      initialResult: fractionalAnswer,
    }),
  );
  expect(html).toContain('Neurons used: 5. Reserved: 60. Left today: 844.');
  const neuronsLine = html.match(/Neurons used:[^<]*/)?.[0];
  expect(neuronsLine).toBeDefined();
  expect(neuronsLine).not.toMatch(/\d+\.\d+/);
});
