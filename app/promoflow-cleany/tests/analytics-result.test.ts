import { describe, expect, it } from 'vitest';
import { analyticsRows } from '../server/routes/lakebase/promoflow-routes';

describe('analyticsRows', () => {
  it('preserves AppKit normalized data rows', () => {
    const rows = [{ opportunity_id: 'OPP-1', expected_incremental_margin: 1250 }];

    expect(analyticsRows({ data: rows })).toEqual(rows);
  });

  it('supports legacy data_array results', () => {
    expect(analyticsRows({
      data_array: [['OPP-2', 900]],
      manifest: { schema: { columns: [{ name: 'opportunity_id' }, { name: 'expected_incremental_margin' }] } },
    })).toEqual([{ opportunity_id: 'OPP-2', expected_incremental_margin: 900 }]);
  });
});
