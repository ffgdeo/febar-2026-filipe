import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('PromoFlow app smoke contract', () => {
  const source = readFileSync(new URL('../client/src/App.tsx', import.meta.url), 'utf8');

  test('renders the branded app shell and four decision surfaces', () => {
    expect(source).toContain('Cleany PromoFlow');
    expect(source).toContain('Opportunity Inbox');
    expect(source).toContain('Scenario Studio');
    expect(source).toContain('Decision Workspace');
    expect(source).toContain('Ask PromoFlow');
    expect(source).not.toContain('Supply Action Center');
    expect(source).toContain('Build scenario');
    expect(source).toContain('Discount %');
    expect(source).toContain('Calculate and add to comparison');
    expect(source).toContain('Availability check');
    expect(source).toContain('AI Decision Brief');
    expect(source).toContain('creates no actions');
  });

  test('discloses Genie execution identity and verification requirement', () => {
    expect(source).toContain('Signed in as');
    expect(source).toContain('Query attachments expose generated SQL');
    expect(source).toContain('AI-generated — verify');
  });

  test('uses neutral role copy and omits the persona ownership panel', () => {
    expect(source).toContain('Hybrid architecture');
    expect(source).toContain('Human-controlled workflow');
    expect(source).toContain('does not autonomously commit spend');
    expect(source).not.toContain('ExecutiveAnalyticsSection');
    expect(source).not.toContain('<svg');
    expect(source).not.toContain('HorizontalBars');
    expect(source).not.toContain('RevenueSvg');
    expect(source).not.toContain('MarginSvg');
    expect(source).not.toContain('DonutChart');
    expect(source).not.toContain('LineChart');
    expect(source).not.toMatch(/Jeff|Trevor|Emily|Sarah|Decision ownership/i);
  });
});
