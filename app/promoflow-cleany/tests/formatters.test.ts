import { describe, expect, test } from 'vitest';
import { formatDateOnly } from '../client/src/lib/formatters';

describe('formatDateOnly', () => {
  test('formats the live Lakebase ISO payload without appending another time', () => {
    expect(formatDateOnly('2026-11-18T00:00:00.000Z')).toBe('11/18/2026');
  });

  test('formats PostgreSQL date-only strings without timezone conversion', () => {
    expect(formatDateOnly('2026-11-29')).toBe('11/29/2026');
  });

  test.each([null, undefined, '', 'not-a-date', '2026-02-30'])('returns a safe placeholder for %s', (value) => {
    expect(formatDateOnly(value)).toBe('—');
  });
});
