import type { Application, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { generatePromotionNarrative, type PromotionNarrativeFacts } from '../../unity-gateway/promotion-narrative';
import { OPERATIONAL_DDL } from './operational-schema';

interface QueryResult { rows: Record<string, unknown>[] }
interface SqlResult {
  data?: Record<string, unknown>[];
  data_array?: unknown[][];
  manifest?: { schema?: { columns?: Array<{ name?: string }> } };
}
interface Client { query(text: string, params?: unknown[]): Promise<QueryResult>; release(): void }
interface PromoFlowAppKit {
  analytics: { query(text: string): Promise<SqlResult | Record<string, unknown>[]> };
  lakebase: { query(text: string, params?: unknown[]): Promise<QueryResult>; pool: { connect(): Promise<Client> } };
  server: { extend(fn: (app: Application) => void): void };
}
const S = 'promoflow_ops';
const SYNCED_PLANS = 'promoflow_serving.planned_promotions';
const SOURCE_REFS = {
  opportunities: 'promoflow.promoflow_gold.planner_opportunities',
  feasibility: 'promoflow.promoflow_gold.promotion_feasibility',
};

export const ScenarioInput = z.object({
  opportunityId: z.string().min(1).max(300), skuId: z.string().min(1).max(80), clusterId: z.string().min(1).max(80),
  startDate: z.string().date(), endDate: z.string().date(),
  mechanic: z.enum(['TPR', 'FEATURE', 'DISPLAY', 'FEATURE_DISPLAY', 'BOGO']),
  discountPct: z.number().min(0).max(60), listPrice: z.number().positive().max(10000),
  unitCost: z.number().nonnegative().max(10000), notes: z.string().max(2000).optional(), title: z.string().max(200).optional(),
}).superRefine((v, c) => {
  if (v.endDate < v.startDate) c.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after start date' });
  if (v.unitCost >= v.listPrice) c.addIssue({ code: 'custom', path: ['unitCost'], message: 'Unit cost must be below list price' });
});
const ComparisonInput = z.object({ name: z.string().min(1).max(200).default('Scenario comparison'), scenarioIds: z.array(z.string()).min(2).max(3) });
const Transition = z.object({ status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']), notes: z.string().max(2000).optional() });
type Scenario = z.infer<typeof ScenarioInput>;

function actor(req: Request) { return req.header('x-forwarded-email') ?? req.header('x-forwarded-user') ?? 'authenticated-user'; }
function number(value: unknown, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function text(value: unknown, fallback = '') { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback; }
function isoDate(value: unknown) { return new Date(String(value)).toISOString().slice(0, 10); }
export function analyticsRows(result: SqlResult | Record<string, unknown>[]): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.data)) return result.data;
  const names = result.manifest?.schema?.columns?.map((c) => c.name ?? '') ?? [];
  return (result.data_array ?? []).map((values) => Object.fromEntries(names.map((name, i) => [name, values[i]])));
}
async function warehouseRows(appkit: PromoFlowAppKit, _req: Request, sql: string) {
  return analyticsRows(await appkit.analytics.query(sql));
}

const OPPORTUNITY_SQL = `SELECT o.*, f.plan_as_of_date AS inventory_as_of_date,
 f.projected_opening_inventory_units AS on_hand_units,f.planned_receipt_units AS confirmed_inbound_units,
 0 AS scheduled_inbound_units,f.safety_stock_units,f.committed_baseline_units,f.incremental_promotion_demand_units,
 f.available_for_incremental_promotion_units,f.promotion_demand_coverage_ratio,f.projected_shortfall_units,
 f.readiness_status,f.readiness_reason,f.calculation_version AS feasibility_calculation_version
 FROM promoflow.promoflow_gold.planner_opportunities o
 LEFT JOIN promoflow.promoflow_gold.promotion_feasibility f ON f.opportunity_id=o.opportunity_id
 ORDER BY o.event_start_date,o.expected_incremental_margin DESC LIMIT 500`;

const PROMOTION_HISTORY_SQL = `SELECT promotion_id,sku_id,product_name,category,cluster_id,cluster_name,mechanic,
 discount_pct,start_date,end_date,baseline_units,actual_units,incremental_units,modeled_uplift_rate,
 actual_revenue,trade_spend,incremental_margin,promotion_roi,lost_sales_units,revenue_at_risk,
 availability_outcome,success_classification,measurement_assumption
 FROM promoflow.promoflow_gold.promotion_explorer
 ORDER BY start_date DESC,promotion_id DESC LIMIT 1200`;

const UPCOMING_EVENTS_SQL = `SELECT event_id,event_name,event_start_date,event_end_date,category_affinity,event_type,
 retailer_scope,planning_status,source_updated_at
 FROM promoflow.promoflow_gold.cpg_event_calendar
 WHERE event_end_date >= current_date()
 ORDER BY event_start_date,event_name,category_affinity`;

async function upcomingPlans(appkit: PromoFlowAppKit) {
  const imported = await appkit.lakebase.query(`SELECT plan_id,event_id,event_name,category,start_date,end_date,
    sku_id,product_name,cluster_id,cluster_name,mechanic,discount_pct,planned_incremental_units,plan_status,
    projected_opening_inventory_units,planned_receipt_units,available_incremental_units,availability_coverage_ratio,
    projected_shortfall_units,readiness_status,risk_reason,supply_plan_as_of_date,supply_source_updated_at AS source_updated_at,source_system
    FROM ${SYNCED_PLANS} ORDER BY start_date,plan_id`);
  const authored = await appkit.lakebase.query(`SELECT s.scenario_id AS plan_id,v.event_id,v.event_name,v.category,
    v.start_date,v.end_date,v.sku_id,v.product_name,v.cluster_id,v.cluster_name,v.promotion_mechanic AS mechanic,
    v.discount_pct,v.modeled_uplift_units AS planned_incremental_units,s.status AS plan_status,
    v.on_hand_units AS projected_opening_inventory_units,v.inbound_units AS planned_receipt_units,
    v.projected_available_units AS available_incremental_units,v.availability_coverage_pct / 100.0 AS availability_coverage_ratio,
    v.potential_shortfall_units AS projected_shortfall_units,v.feasibility_status AS readiness_status,
    CASE WHEN v.inbound_units = 0 AND v.potential_shortfall_units > 0 THEN 'NO_PLANNED_RECEIPT_AND_INVENTORY_SHORTFALL'
      WHEN v.potential_shortfall_units > 0 THEN 'PROJECTED_INVENTORY_SHORTFALL'
      WHEN v.feasibility_status = 'REVIEW' THEN 'LIMITED_AVAILABILITY_BUFFER' ELSE 'SUPPLY_POSITION_READY' END AS risk_reason,
    v.availability_as_of AS supply_plan_as_of_date,s.updated_at AS source_updated_at,'PROMOFLOW_APP' AS source_system
    FROM ${S}.scenarios s JOIN ${S}.scenario_versions v
      ON v.scenario_id=s.scenario_id AND v.version=s.current_version
    WHERE s.status <> 'ARCHIVED' ORDER BY v.start_date,s.scenario_id`);
  return [...imported.rows, ...authored.rows];
}

function normalizeOpportunity(row: Record<string, unknown>): Record<string, unknown> {
  const mechanic = String(row.recommended_mechanic) === 'DISCOUNT' ? 'TPR' : String(row.recommended_mechanic);
  const economics = String(row.economics_status);
  return {
    ...row,
    opportunity_id: String(row.opportunity_id), recommended_mechanic: mechanic,
    recommended_discount_pct: number(row.recommended_discount_pct),
    list_price: number(row.list_price), unit_cost: number(row.standard_cost ?? row.unit_cost),
    expected_incremental_margin: number(row.expected_incremental_margin),
    expected_promotion_roi: number(row.expected_promotion_roi),
    expected_modeled_uplift_pct: number(row.expected_modeled_uplift_pct),
    economics_status: economics === 'RECOMMEND' ? 'RECOMMENDED' : economics === 'REVIEW_ECONOMICS' ? 'REVIEW' : economics,
    feasibility_status: text(row.readiness_status, 'REVIEW'),
    availability_coverage_pct: row.promotion_demand_coverage_ratio == null ? null : number(row.promotion_demand_coverage_ratio) * 100,
    potential_shortfall_units: number(row.projected_shortfall_units),
  };
}

const mechanicMultiplier: Record<Scenario['mechanic'], number> = { TPR: 1, FEATURE: 1.05, DISPLAY: 1.1, FEATURE_DISPLAY: 1.18, BOGO: 1.25 };
export function recommendationStatus(margin: number, roi: number) {
  return margin > 0 && roi > 0 ? 'RECOMMENDED' as const : margin === 0 || roi === 0 ? 'REVIEW' as const : 'AVOID' as const;
}
export function decisionCreateErrorResponse(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42703'
    ? { status: 503, body: { error: 'Decision storage schema is being upgraded. Retry shortly.', code: 'DECISION_SCHEMA_OUTDATED' } }
    : { status: 500, body: { error: 'Could not create promotion decision', code: 'DECISION_CREATE_FAILED' } };
}
export function buildOpportunityFilters(query: Record<string, unknown>) {
  return Object.fromEntries(['sku', 'category', 'cluster', 'event'].flatMap((key) => typeof query[key] === 'string' && query[key] ? [[key, query[key]]] : []));
}

export function calculateScenarioFromOpportunity(input: Scenario, raw: Record<string, unknown>) {
  const o = normalizeOpportunity(raw);
  if (String(o.recommended_sku_id) !== input.skuId || String(o.cluster_id) !== input.clusterId)
    throw new Error('Scenario SKU and market must match the governed opportunity');
  const duration = Math.max(1, Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86400000) + 1);
  const anchorDuration = Math.max(1, Math.round((Date.parse(isoDate(o.event_end_date)) - Date.parse(isoDate(o.event_start_date))) / 86400000) + 1);
  const durationFactor = duration / anchorDuration;
  const baseDiscount = Math.max(0.01, number(o.recommended_discount_pct));
  const discountRate = input.discountPct / 100;
  const discountResponse = Math.min(2, Math.max(0, discountRate / baseDiscount));
  const baseMechanic = String(o.recommended_mechanic) as Scenario['mechanic'];
  const mechanicResponse = mechanicMultiplier[input.mechanic] / (mechanicMultiplier[baseMechanic] ?? 1);
  const baselineUnits = number(o.expected_baseline_units) * durationFactor;
  const upliftUnits = number(o.expected_modeled_uplift_units) * durationFactor * discountResponse * mechanicResponse;
  const predictedUnits = Math.max(0, baselineUnits + upliftUnits);
  const tradeSpend = predictedUnits * input.listPrice * discountRate;
  const margin = predictedUnits * (input.listPrice * (1 - discountRate) - input.unitCost) - baselineUnits * (input.listPrice - input.unitCost);
  const roi = tradeSpend === 0 ? 0 : margin / tradeSpend;
  const available = number(o.available_for_incremental_promotion_units);
  const shortfall = Math.max(0, upliftUnits - available);
  const coverageRatio = upliftUnits > 0 ? available / upliftUnits : null;
  const feasibility = coverageRatio == null ? 'REVIEW' : coverageRatio < 0.9 ? 'CONSTRAINED' : coverageRatio < 1.1 ? 'REVIEW' : 'READY';
  return {
    ...input, eventId: String(o.event_id), eventName: String(o.event_name), productName: String(o.recommended_product_name),
    category: String(o.category), clusterName: String(o.cluster_name), durationDays: duration,
    predictedPromotionUnits: Number(predictedUnits.toFixed(2)), predictedBaselineUnits: Number(baselineUnits.toFixed(2)),
    modeledUpliftUnits: Number(upliftUnits.toFixed(2)), modeledUpliftPct: baselineUnits ? Number((upliftUnits / baselineUnits).toFixed(6)) : 0,
    estimatedTradeSpend: Number(tradeSpend.toFixed(2)), estimatedIncrementalMargin: Number(margin.toFixed(2)),
    estimatedPromotionRoi: Number(roi.toFixed(6)), recommendationStatus: recommendationStatus(margin, roi),
    onHandUnits: number(o.on_hand_units), inboundUnits: number(o.confirmed_inbound_units) + number(o.scheduled_inbound_units),
    committedUnits: number(o.committed_baseline_units), safetyStockUnits: number(o.safety_stock_units),
    projectedAvailableUnits: Number(available.toFixed(2)), availabilityCoveragePct: coverageRatio == null ? null : Number((coverageRatio * 100).toFixed(2)),
    potentialShortfallUnits: Number(shortfall.toFixed(2)), inventoryGapUnits: Number(shortfall.toFixed(2)), feasibilityStatus: feasibility,
    availabilityAsOf: String(o.inventory_as_of_date), anchorModelName: String(o.model_name), anchorModelVersion: String(o.model_version),
    mlflowRunId: o.mlflow_run_id == null ? null : text(o.mlflow_run_id), scoredAt: text(o.scored_at_utc, new Date().toISOString()),
    calculationVersion: 'scenario-response-v3', analyticsFreshnessAt: new Date().toISOString(), sourceRefs: SOURCE_REFS,
    disclosure: 'Modeled, not causal. Economics use transparent scenario response factors; availability is a point-in-time feasibility check and creates no supply action.',
  };
}

export async function calculateScenario(appkit: PromoFlowAppKit, req: Request, input: Scenario) {
  const rows = await warehouseRows(appkit, req, OPPORTUNITY_SQL);
  const opportunity = rows.find((row) => String(row.opportunity_id) === input.opportunityId);
  if (!opportunity) throw new Error('Governed opportunity not found or no longer current');
  return calculateScenarioFromOpportunity(input, opportunity);
}

async function saveScenario(appkit: PromoFlowAppKit, req: Request, input: Scenario) {
  const d = await calculateScenario(appkit, req, input), scenarioId = `SCN-${randomUUID()}`, who = actor(req);
  const client = await appkit.lakebase.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO ${S}.scenarios(scenario_id,title,opportunity_id,owner_principal) VALUES($1,$2,$3,$4)`,
      [scenarioId, input.title ?? `${d.eventName} · ${d.productName} · ${d.clusterName}`, input.opportunityId, who]);
    await client.query(`INSERT INTO ${S}.scenario_versions(
      scenario_id,version,created_by,change_note,event_id,event_name,sku_id,product_name,category,cluster_id,cluster_name,
      start_date,end_date,promotion_mechanic,discount_pct,list_price,unit_cost,predicted_baseline_units,modeled_uplift_units,
      modeled_uplift_pct,predicted_promotion_units,estimated_trade_spend,estimated_incremental_margin,estimated_promotion_roi,
      on_hand_units,inbound_units,committed_units,safety_stock_units,projected_available_units,availability_coverage_pct,
      potential_shortfall_units,feasibility_status,availability_as_of,model_name,model_version,mlflow_run_id,scored_at,
      calculation_version,analytics_freshness_at,source_refs,assumptions)
      VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39::jsonb,$40::jsonb)`,
      [scenarioId,who,input.notes??null,d.eventId,d.eventName,d.skuId,d.productName,d.category,d.clusterId,d.clusterName,
       d.startDate,d.endDate,d.mechanic,d.discountPct,d.listPrice,d.unitCost,d.predictedBaselineUnits,d.modeledUpliftUnits,
       d.modeledUpliftPct,d.predictedPromotionUnits,d.estimatedTradeSpend,d.estimatedIncrementalMargin,d.estimatedPromotionRoi,
       d.onHandUnits,d.inboundUnits,d.committedUnits,d.safetyStockUnits,d.projectedAvailableUnits,d.availabilityCoveragePct,
       d.potentialShortfallUnits,d.feasibilityStatus,d.availabilityAsOf,d.anchorModelName,d.anchorModelVersion,d.mlflowRunId,
       d.scoredAt,d.calculationVersion,d.analyticsFreshnessAt,JSON.stringify(d.sourceRefs),JSON.stringify([d.disclosure])]);
    await client.query(`INSERT INTO ${S}.audit_events(audit_event_id,entity_type,entity_id,event_type,actor_principal,event_payload)
      VALUES($1,'SCENARIO',$2,'CREATED',$3,$4::jsonb)`, [`AUD-${randomUUID()}`,scenarioId,who,JSON.stringify({version:1,opportunityId:input.opportunityId})]);
    await client.query('COMMIT');
    return { scenarioId, version: 1, status: 'DRAFT', ...d };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

function scenarioSelect() { return `SELECT s.scenario_id AS decision_id,s.scenario_id,s.status,s.title,s.current_version,
 v.*,b.brief_id,b.executive_recommendation,b.generated_at AS brief_generated_at
 FROM ${S}.scenarios s JOIN ${S}.scenario_versions v ON v.scenario_id=s.scenario_id AND v.version=s.current_version
 LEFT JOIN LATERAL(SELECT * FROM ${S}.ai_decision_briefs b WHERE b.scenario_id=s.scenario_id AND b.scenario_version=s.current_version
 ORDER BY b.generated_at DESC LIMIT 1)b ON true` }

export async function setupPromoFlowRoutes(appkit: PromoFlowAppKit) {
  const permission = await appkit.lakebase.query(`SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)
    THEN has_schema_privilege($1,'CREATE') ELSE true END AS can_ddl`, [S]);
  if (permission.rows[0]?.can_ddl === true) await appkit.lakebase.query(OPERATIONAL_DDL);
  appkit.server.extend((app) => {
    app.get('/api/whoami', (req,res) => res.json({email:req.header('x-forwarded-email')??null,user:req.header('x-forwarded-user')??null,analyticsIdentity:'app-service-principal',operationalIdentity:'app-service-principal'}));

    const opportunities = async (req: Request, res: Response) => {
      try {
        const filters = buildOpportunityFilters(req.query), rows = (await warehouseRows(appkit,req,OPPORTUNITY_SQL)).map(normalizeOpportunity)
          .filter((r) => !filters.sku || r.recommended_sku_id===filters.sku)
          .filter((r) => !filters.category || r.category===filters.category)
          .filter((r) => !filters.cluster || r.cluster_id===filters.cluster)
          .filter((r) => !filters.event || r.event_id===filters.event);
        res.json({data:rows,source:Object.values(SOURCE_REFS),servingMode:'LIVE_WAREHOUSE',modeledNotCausal:true});
      } catch(error){ console.error('Opportunity analytics failed',error); res.status(503).json({error:'Live governed opportunities are unavailable'}); }
    };
    app.get('/api/opportunities', opportunities); app.get('/api/workbench/opportunities', opportunities);

    app.get('/api/promotion-history', async(req,res) => {
      try {
        const rows = await warehouseRows(appkit,req,PROMOTION_HISTORY_SQL);
        res.json({data:rows,source:'promoflow.promoflow_gold.promotion_explorer',measurement:'MODELED_OBSERVATIONAL_NOT_CAUSAL'});
      } catch(error) { console.error('Promotion history failed',error); res.status(503).json({error:'Historical promotion analysis is unavailable'}); }
    });

    app.get('/api/upcoming-promotions', async(_req,res) => {
      try {
        const rows = await upcomingPlans(appkit);
        res.json({data:rows,source:[SYNCED_PLANS,`${S}.scenario_versions`],servingMode:'LAKEBASE'});
      } catch(error) { console.error('Upcoming plans failed',error); res.status(503).json({error:'Upcoming promotion plans are unavailable'}); }
    });

    app.get('/api/overview', async(req,res) => {
      try {
        const [plans, events, opportunities, history] = await Promise.all([
          upcomingPlans(appkit),
          warehouseRows(appkit,req,UPCOMING_EVENTS_SQL),
          warehouseRows(appkit,req,OPPORTUNITY_SQL),
          warehouseRows(appkit,req,PROMOTION_HISTORY_SQL),
        ]);
        const plannedEventIds = new Set(plans.map((p) => text(p.event_id)));
        const eventMap = new Map<string,Record<string,unknown>>();
        for (const event of events) if (!plannedEventIds.has(text(event.event_id))) eventMap.set(text(event.event_id),event);
        const months = new Map<string,number>();
        for (const plan of plans) { const month=text(plan.start_date).slice(0,7); months.set(month,(months.get(month)??0)+1); }
        const pendingApprovals = plans.filter((p) => ['PENDING_APPROVAL','SUBMITTED'].includes(text(p.plan_status))).length;
        const atRisk = plans.filter((p) => ['REVIEW','CONSTRAINED'].includes(text(p.readiness_status))).length;
        const noReceipts = plans.filter((p) => text(p.risk_reason)==='NO_PLANNED_RECEIPT_AND_INVENTORY_SHORTFALL').length;
        const constrainedShortfallUnits = plans.filter((p) => text(p.readiness_status)==='CONSTRAINED')
          .reduce((sum,p)=>sum+number(p.projected_shortfall_units),0);
        const profitable = opportunities.filter((o)=>number(o.expected_incremental_margin)>0 && number(o.expected_promotion_roi)>0);
        const modeledOpportunityMargin = profitable.reduce((sum,o)=>sum+number(o.expected_incremental_margin),0);
        const readyOpportunityMargin = profitable.filter((o)=>text(o.readiness_status)==='READY')
          .reduce((sum,o)=>sum+number(o.expected_incremental_margin),0);
        const historicalRevenueAtRisk = history.filter((p)=>number(p.lost_sales_units)>0)
          .reduce((sum,p)=>sum+number(p.revenue_at_risk),0);
        res.json({
          kpis:{totalUpcoming:plans.length,pendingApprovals,atRisk,noReceipts,unplannedEvents:eventMap.size,
            approved:plans.filter((p)=>text(p.plan_status)==='APPROVED').length,constrainedShortfallUnits,
            modeledOpportunityMargin,readyOpportunityMargin,historicalRevenueAtRisk},
          monthlyPlans:[...months.entries()].sort().map(([month,count])=>({month,count})),
          unplannedEvents:[...eventMap.values()].slice(0,12),
          riskQueue:plans.filter((p)=>['REVIEW','CONSTRAINED'].includes(text(p.readiness_status))).slice(0,10),
          freshness:{events:'Unity Catalog live query',plans:'Lakebase synced + native operational tables',
            value:'Unity Catalog governed opportunity and promotion history'},
        });
      } catch(error) { console.error('Overview failed',error); res.status(503).json({error:'Planning overview is unavailable'}); }
    });

    app.get('/api/scenario-references', async (req,res) => {
      try { const rows=(await warehouseRows(appkit,req,OPPORTUNITY_SQL)).map(normalizeOpportunity); res.json({
        skus:[...new Map(rows.map(r=>[String(r.recommended_sku_id),{id:r.recommended_sku_id,name:r.recommended_product_name,category:r.category}])).values()],
        clusters:[...new Map(rows.map(r=>[String(r.cluster_id),{id:r.cluster_id,name:r.cluster_name}])).values()],
        events:[...new Map(rows.map(r=>[String(r.event_id),{id:r.event_id,name:r.event_name,startDate:r.event_start_date,endDate:r.event_end_date}])).values()],
      }); } catch(error){ console.error(error); res.status(503).json({error:'Scenario reference data is unavailable'}); }
    });

    app.post('/api/scenarios/preview', async(req,res)=>{ const parsed=ScenarioInput.safeParse(req.body); if(!parsed.success){res.status(400).json({error:'Invalid scenario inputs',details:parsed.error.flatten()});return;}
      try{res.json(await calculateScenario(appkit,req,parsed.data));}catch(error){res.status(422).json({error:error instanceof Error?error.message:'Scenario calculation failed'});} });
    app.post('/api/scenarios', async(req,res)=>{ const parsed=ScenarioInput.safeParse(req.body); if(!parsed.success){res.status(400).json({error:'Invalid scenario inputs',details:parsed.error.flatten()});return;}
      try{res.status(201).json(await saveScenario(appkit,req,parsed.data));}catch(error){console.error(error);res.status(500).json({error:'Could not save scenario'});} });

    app.post('/api/scenario-comparisons', async(req,res)=>{ const parsed=ComparisonInput.safeParse(req.body); if(!parsed.success){res.status(400).json({error:'Choose two or three saved scenarios'});return;}
      const client=await appkit.lakebase.pool.connect(),comparisonId=`CMP-${randomUUID()}`,who=actor(req); try{await client.query('BEGIN');
        const versions=await client.query(`SELECT scenario_id,current_version FROM ${S}.scenarios WHERE scenario_id=ANY($1::text[])`,[parsed.data.scenarioIds]);
        if(versions.rows.length!==parsed.data.scenarioIds.length)throw new Error('One or more scenarios do not exist');
        await client.query(`INSERT INTO ${S}.scenario_comparisons(comparison_id,name,owner_principal)VALUES($1,$2,$3)`,[comparisonId,parsed.data.name,who]);
        for(const [i,id] of parsed.data.scenarioIds.entries()){const row=versions.rows.find(x=>x.scenario_id===id)!;await client.query(`INSERT INTO ${S}.scenario_comparison_members(comparison_id,scenario_id,scenario_version,display_order)VALUES($1,$2,$3,$4)`,[comparisonId,id,row.current_version,i+1]);}
        await client.query(`INSERT INTO ${S}.audit_events(audit_event_id,entity_type,entity_id,event_type,actor_principal,event_payload)VALUES($1,'COMPARISON',$2,'CREATED',$3,$4::jsonb)`,[`AUD-${randomUUID()}`,comparisonId,who,JSON.stringify({scenarioIds:parsed.data.scenarioIds})]);
        await client.query('COMMIT');res.status(201).json({comparisonId,name:parsed.data.name,scenarioIds:parsed.data.scenarioIds});
      }catch(error){await client.query('ROLLBACK');res.status(422).json({error:error instanceof Error?error.message:'Could not save comparison'});}finally{client.release();} });

    app.get('/api/decisions',async(_req,res)=>{try{const {rows}=await appkit.lakebase.query(`${scenarioSelect()} ORDER BY s.updated_at DESC`);res.json(rows);}catch(error){console.error(error);res.status(500).json({error:'Decision workspace unavailable'});} });
    app.patch('/api/decisions/:id',async(req,res)=>{const parsed=Transition.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid decision transition'});return;}
      const decision=parsed.data.status==='SUBMITTED'?'SUBMIT':parsed.data.status==='APPROVED'?'APPROVE':'REJECT',who=actor(req),client=await appkit.lakebase.pool.connect();try{await client.query('BEGIN');
        const current=await client.query(`SELECT scenario_id,status,current_version FROM ${S}.scenarios WHERE scenario_id=$1 FOR UPDATE`,[req.params.id]);if(!current.rows[0]){await client.query('ROLLBACK');res.status(404).json({error:'Scenario not found'});return;}
        const allowed:Record<string,string[]>={DRAFT:['SUBMITTED'],REJECTED:['SUBMITTED'],SUBMITTED:['APPROVED','REJECTED']},currentStatus=text(current.rows[0].status);if(!(allowed[currentStatus]??[]).includes(parsed.data.status)){await client.query('ROLLBACK');res.status(409).json({error:`Cannot move ${currentStatus} to ${parsed.data.status}`});return;}
        const decisionId=`DEC-${randomUUID()}`;await client.query(`INSERT INTO ${S}.promotion_decisions(decision_id,scenario_id,scenario_version,decision,actor_principal,rationale)VALUES($1,$2,$3,$4,$5,$6)`,[decisionId,req.params.id,current.rows[0].current_version,decision,who,parsed.data.notes??null]);
        await client.query(`UPDATE ${S}.scenarios SET status=$2,updated_at=now(),submitted_at=CASE WHEN $2='SUBMITTED' THEN now() ELSE submitted_at END,decided_at=CASE WHEN $2 IN('APPROVED','REJECTED') THEN now() ELSE decided_at END WHERE scenario_id=$1`,[req.params.id,parsed.data.status]);
        await client.query(`INSERT INTO ${S}.audit_events(audit_event_id,entity_type,entity_id,event_type,actor_principal,event_payload)VALUES($1,'DECISION',$2,$3,$4,$5::jsonb)`,[`AUD-${randomUUID()}`,decisionId,decision,who,JSON.stringify({scenarioId:req.params.id,status:parsed.data.status})]);
        await client.query('COMMIT');const {rows}=await appkit.lakebase.query(`${scenarioSelect()} WHERE s.scenario_id=$1`,[req.params.id]);res.json(rows[0]);
      }catch(error){await client.query('ROLLBACK');console.error(error);res.status(500).json({error:'Could not record decision'});}finally{client.release();} });

    app.post('/api/scenarios/:id/decision-brief',async(req,res)=>{try{const {rows}=await appkit.lakebase.query(`${scenarioSelect()} WHERE s.scenario_id=$1`,[req.params.id]);const d=rows[0];if(!d){res.status(404).json({error:'Scenario not found'});return;}
      const facts:PromotionNarrativeFacts={opportunityId:String(d.opportunity_id),eventName:String(d.event_name),eventStartDate:isoDate(d.start_date),eventEndDate:isoDate(d.end_date),category:String(d.category),productName:String(d.product_name),clusterName:String(d.cluster_name),mechanic:String(d.promotion_mechanic),discountPct:number(d.discount_pct),expectedUpliftPct:number(d.modeled_uplift_pct)*100,expectedIncrementalMargin:number(d.estimated_incremental_margin),expectedPromotionRoi:number(d.estimated_promotion_roi),predictedPromotionUnits:number(d.predicted_promotion_units),feasibilityStatus:String(d.feasibility_status),availabilityCoveragePct:d.availability_coverage_pct==null?null:number(d.availability_coverage_pct),potentialShortfallUnits:number(d.potential_shortfall_units),availabilityAsOf:String(d.availability_as_of),sourceRefs:d.source_refs as Record<string,unknown>};
      const generated=await generatePromotionNarrative(facts),briefId=`BRF-${randomUUID()}`,who=actor(req);await appkit.lakebase.query(`INSERT INTO ${S}.ai_decision_briefs(brief_id,scenario_id,scenario_version,generation_status,executive_recommendation,supporting_evidence,assumptions_uncertainties,commercial_risks,validation_questions,suggested_next_action,raw_text,model_service,prompt_version,input_fingerprint,response_id,request_tags,usage_metadata,latency_ms,source_refs,source_freshness_at,generated_by)VALUES($1,$2,$3,'SUCCEEDED',$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18::jsonb,$19,$20)`,[briefId,req.params.id,d.current_version,generated.brief.executiveRecommendation,JSON.stringify(generated.brief.supportingEvidence),JSON.stringify(generated.brief.assumptionsAndUncertainties),JSON.stringify(generated.brief.commercialRisks),JSON.stringify(generated.brief.validationQuestions),generated.brief.suggestedNextAction,generated.narrative,generated.modelService,generated.promptVersion,generated.inputFingerprint,generated.responseId,JSON.stringify(generated.requestTags),JSON.stringify(generated.usage),generated.latencyMs,JSON.stringify(facts.sourceRefs??{}),d.analytics_freshness_at,who]);
      res.status(201).json({brief_id:briefId,...generated.brief,narrative:generated.brief.executiveRecommendation,model_service:generated.modelService,prompt_version:generated.promptVersion,response_id:generated.responseId,latency_ms:generated.latencyMs,generated_at:new Date().toISOString(),groundedFacts:facts});
    }catch(error){console.error('Decision brief failed',error);res.status(502).json({error:'Could not generate a governed decision brief'});} });
  });
}
