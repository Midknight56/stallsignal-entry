import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import About from '../src/pages/About';

describe('About page judge-path', () => {
  it('includes the fifth step linking to /proof with exact text', () => {
    const html = renderToStaticMarkup(createElement(About, { href: (path: string) => path }));
    expect(html).toContain(
      '<li><a href="/proof">See the guards.</a> Six payment checks run in your browser against a pretend PayPal.</li>',
    );
  });
});

describe('About page numbers and budget', () => {
  it('says plainly what happens when model cannot answer and omits 45', () => {
    const html = renderToStaticMarkup(createElement(About, { href: (path: string) => path }));
    const text = html.replace(/&#x27;/g, "'");
    expect(text).toContain(
      "If the model is off, today's budget is used up, or its answer fails a check, the plan comes from code and the panel says so.",
    );
    expect(html).not.toContain('45');
  });
});

describe('About page Map data section', () => {
  it('contains h2 Map data and the long block first and last sentences', () => {
    const html = renderToStaticMarkup(createElement(About, { href: (path: string) => path }));
    expect(html).toContain('<h2>Map data</h2>');
    expect(html).toContain('Map data: U.S. Census Bureau.');
    expect(html).toContain('TIGER/Line is a registered trademark of the U.S. Census Bureau.');
  });
});
