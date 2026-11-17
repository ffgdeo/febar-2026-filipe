import { describe, expect, test } from 'vitest';
import { decisionCreateErrorResponse } from '../server/routes/lakebase/promoflow-routes';

describe('decision create error classification', () => {
  test('returns an actionable safe response for a missing migration column', () => {
    expect(decisionCreateErrorResponse({ code: '42703', message: 'sensitive database detail' })).toEqual({
      status: 503,
      body: { error: 'Decision storage schema is being upgraded. Retry shortly.', code: 'DECISION_SCHEMA_OUTDATED' },
    });
  });
  test('does not expose unknown database details', () => {
    expect(decisionCreateErrorResponse(new Error('secret detail'))).toEqual({
      status: 500,
      body: { error: 'Could not create promotion decision', code: 'DECISION_CREATE_FAILED' },
    });
  });
});
