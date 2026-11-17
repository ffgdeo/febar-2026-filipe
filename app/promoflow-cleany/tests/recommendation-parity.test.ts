import { describe, expect, test } from 'vitest';
import { buildOpportunityFilters, calculateScenarioFromOpportunity, recommendationStatus } from '../server/routes/lakebase/promoflow-routes';

const opportunity = {
  opportunity_id: 'OPP-1', event_id: 'EVENT-1', event_name: 'Black Friday', event_start_date: '2026-11-23', event_end_date: '2026-11-29',
  recommended_sku_id: 'SKU-001', recommended_product_name: 'FreshWave', category: 'Laundry', cluster_id: 'CL-06', cluster_name: 'West Coast',
  recommended_mechanic: 'DISPLAY', recommended_discount_pct: 0.1, list_price: 13.99, standard_cost: 5.93,
  expected_baseline_units: 1200, expected_modeled_uplift_units: 300, expected_modeled_uplift_pct: 0.25,
  expected_incremental_margin: 1000, expected_promotion_roi: 1.1, economics_status: 'RECOMMEND',
  on_hand_units: 900, confirmed_inbound_units: 300, scheduled_inbound_units: 100, safety_stock_units: 100,
  committed_baseline_units: 800, available_for_incremental_promotion_units: 400, inventory_as_of_date: '2026-11-15',
  model_name: 'promotion_demand_model', model_version: '2', mlflow_run_id: 'run-1', scored_at_utc: '2026-11-16T00:00:00Z',
};
const input = { opportunityId:'OPP-1',skuId:'SKU-001',clusterId:'CL-06',startDate:'2026-11-23',endDate:'2026-11-29',mechanic:'DISPLAY' as const,discountPct:10,listPrice:13.99,unitCost:5.93 };

describe('hybrid scenario contract', () => {
  test('recalculates economics and feasibility without creating an action', () => {
    const result = calculateScenarioFromOpportunity(input, opportunity);
    expect(result).toMatchObject({ predictedBaselineUnits:1200,modeledUpliftUnits:300,predictedPromotionUnits:1500,
      potentialShortfallUnits:0,feasibilityStatus:'READY',anchorModelVersion:'2' });
    expect(result).not.toHaveProperty('recommendedAction');
  });
  test('flags a scenario whose incremental demand exceeds available incremental units', () => {
    const result=calculateScenarioFromOpportunity({...input,discountPct:20,mechanic:'FEATURE_DISPLAY'},opportunity);
    expect(result.potentialShortfallUnits).toBeGreaterThan(0); expect(result.feasibilityStatus).toBe('CONSTRAINED');
  });
  test('profitability gate never recommends non-positive economics',()=>{
    expect(recommendationStatus(10,.1)).toBe('RECOMMENDED');expect(recommendationStatus(0,.1)).toBe('REVIEW');expect(recommendationStatus(-1,.1)).toBe('AVOID');
  });
  test('filter values remain data rather than SQL fragments',()=>{
    expect(buildOpportunityFilters({sku:'SKU-004',category:'Dish Care',cluster:'CL-01',event:'EVENT-1'})).toEqual({sku:'SKU-004',category:'Dish Care',cluster:'CL-01',event:'EVENT-1'});
  });
});
