import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserRouter, NavLink, Outlet, RouterProvider, useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  GenieChat,
  Input,
  Label,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Boxes,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  History,
  LayoutList,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

type Identity = { email: string | null; user: string | null };
type Mechanic = 'TPR' | 'FEATURE' | 'DISPLAY' | 'FEATURE_DISPLAY' | 'BOGO';
type Opportunity = {
  opportunity_id: string;
  event_name: string;
  event_start_date: string;
  event_end_date: string;
  category: string;
  recommended_sku_id: string;
  recommended_product_name: string;
  cluster_id: string;
  cluster_name: string;
  recommended_mechanic: Mechanic;
  recommended_discount_pct: string;
  list_price: number;
  unit_cost: number;
  expected_modeled_uplift_pct: string;
  expected_incremental_margin: number;
  expected_promotion_roi: number;
  economics_status: 'RECOMMENDED' | 'REVIEW' | 'AVOID';
  evidence_count: number;
  confidence_band: string;
};
type ScenarioInput = {
  opportunityId?: string;
  skuId: string;
  clusterId: string;
  startDate: string;
  endDate: string;
  mechanic: Mechanic;
  discountPct: number;
  listPrice: number;
  unitCost: number;
  notes: string;
};
type Preview = ScenarioInput & {
  predictedPromotionUnits: number;
  predictedBaselineUnits: number;
  modeledUpliftPct: number;
  estimatedTradeSpend: number;
  estimatedIncrementalMargin: number;
  estimatedPromotionRoi: number;
  inventoryGapUnits: number;
  recommendationStatus: 'RECOMMENDED' | 'REVIEW' | 'AVOID';
  anchorModelName: string;
  anchorModelVersion: string;
  disclosure: string;
};
type Decision = {
  decision_id: string;
  scenario_id: string;
  sku_id: string;
  cluster_id: string;
  status: string;
  promotion_mechanic: string;
  discount_pct: string;
  modeled_uplift_pct: string;
  estimated_incremental_margin: string;
  estimated_promotion_roi: string;
  potential_shortfall_units: string;
};
type PlannedPromotion = {
  plan_id: string; event_id: string; event_name: string; category: string; start_date: string; end_date: string;
  sku_id: string; product_name: string; cluster_id: string; cluster_name: string; mechanic: string;
  discount_pct: string | number; planned_incremental_units: string | number; plan_status: string;
  projected_opening_inventory_units: string | number; planned_receipt_units: string | number;
  availability_coverage_ratio: string | number | null; projected_shortfall_units: string | number;
  readiness_status: string; risk_reason: string; source_system: string;
};
type HistoricalPromotion = {
  promotion_id: string; sku_id: string; product_name: string; category: string; cluster_id: string; cluster_name: string;
  mechanic: string; discount_pct: string | number; start_date: string; end_date: string; baseline_units: string | number;
  actual_units: string | number; incremental_units: string | number; modeled_uplift_rate: string | number;
  actual_revenue: string | number; trade_spend: string | number; incremental_margin: string | number;
  promotion_roi: string | number; lost_sales_units: string | number; revenue_at_risk: string | number;
  success_classification: string; measurement_assumption: string;
};
type OverviewData = {
  kpis: { totalUpcoming: number; pendingApprovals: number; atRisk: number; noReceipts: number; unplannedEvents: number; approved: number;
    constrainedShortfallUnits: number; modeledOpportunityMargin: number; readyOpportunityMargin: number; historicalRevenueAtRisk: number };
  monthlyPlans: Array<{ month: string; count: number }>;
  unplannedEvents: Array<Record<string, unknown>>;
  riskQueue: PlannedPromotion[];
  freshness: { events: string; plans: string; value: string };
};
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const units = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const previewKey = (p: Pick<Preview, 'skuId' | 'clusterId' | 'mechanic' | 'discountPct' | 'startDate' | 'endDate'>) =>
  `${p.skuId}|${p.clusterId}|${p.mechanic}|${p.discountPct}|${p.startDate}|${p.endDate}`;

function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(path);
      const b = (await r.json()) as T & { error?: string };
      if (!r.ok) throw new Error(b.error ?? `Request failed (${r.status})`);
      setData(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => void reload(), [reload]);
  return { data, loading, error, reload };
}
function State({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  children: React.ReactNode;
}) {
  if (loading)
    return (
      <div className="grid gap-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  if (error) return <Alert variant="destructive">{error}. Retry or verify the app resource bindings.</Alert>;
  if (empty)
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">Nothing matches this view</p>
        <p className="mt-1 text-sm text-muted-foreground">Adjust filters or refresh the governed source.</p>
      </div>
    );
  return children;
}
const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`;
function Layout() {
  const me = useApi<Identity>('/api/whoami');
  return (
    <div className="min-h-screen bg-muted/25">
      <header className="sticky top-0 z-20 border-b bg-background/95">
        <div className="mx-auto flex max-w-[1480px] items-center gap-4 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Cleany PromoFlow</h1>
            <p className="text-xs text-muted-foreground">Promotion decision workspace</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Badge variant="outline">
              <ShieldCheck className="mr-1 h-3 w-3" />
              Unity Catalog governed
            </Badge>
            <Badge variant="secondary">{me.data?.email ?? me.data?.user ?? 'Signed in'}</Badge>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1480px] gap-8 px-6 py-7 lg:grid-cols-[235px_minmax(0,1fr)]">
        <aside>
          <nav className="sticky top-24 space-y-1">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Plan and decide
            </p>
            <NavLink to="/" end className={navClass}>
              <Activity className="h-4 w-4" />
              Overview
            </NavLink>
            <NavLink to="/history" className={navClass}>
              <History className="h-4 w-4" />
              Past Promotion Analysis
            </NavLink>
            <NavLink to="/upcoming" className={navClass}>
              <CalendarCheck className="h-4 w-4" />
              Upcoming Promotions
            </NavLink>
            <NavLink to="/opportunities" className={navClass}>
              <LayoutList className="h-4 w-4" />
              Opportunity Inbox
            </NavLink>
            <NavLink to="/studio" className={navClass}>
              <FlaskConical className="h-4 w-4" />
              Scenario Studio
            </NavLink>
            <NavLink to="/decisions" className={navClass}>
              <ClipboardCheck className="h-4 w-4" />
              Decision Workspace
            </NavLink>
            <NavLink to="/genie" className={navClass}>
              <Bot className="h-4 w-4" />
              Ask PromoFlow
            </NavLink>
            <div className="mt-6 rounded-lg border bg-background p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Hybrid architecture</p>
              <p className="mt-1">Live UC analytics; drafts, approvals and AI briefs in Lakebase.</p>
            </div>
          </nav>
        </aside>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
function KpiCard({ label, value, detail, attention = false }: { label: string; value: string; detail: string; attention?: boolean }) {
  return <Card><CardContent className="pt-6"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold">{value}</p></div>{attention ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <BarChart3 className="h-5 w-5 text-muted-foreground" />}</div><p className="mt-3 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}
const humanRisk = (value: string) => ({
  NO_FORWARD_SUPPLY_PLAN: 'No forward supply plan',
  NO_PLANNED_RECEIPT_AND_INVENTORY_SHORTFALL: 'No receipt and projected shortfall',
  PROJECTED_INVENTORY_SHORTFALL: 'Projected inventory shortfall',
  LIMITED_AVAILABILITY_BUFFER: 'Limited availability buffer',
  SUPPLY_POSITION_READY: 'Supply position ready',
}[value] ?? value.replaceAll('_', ' ').toLowerCase());

function OverviewPage() {
  const q = useApi<OverviewData>('/api/overview');
  const maxMonth = Math.max(1, ...(q.data?.monthlyPlans.map((m) => m.count) ?? [1]));
  return <div className="space-y-6">
    <div className="flex items-end justify-between gap-4"><div><h2 className="text-3xl font-semibold">Promotion planning overview</h2><p className="mt-2 text-sm text-muted-foreground">The work that needs attention across approvals, event coverage, and inventory feasibility.</p></div><Button variant="outline" onClick={() => void q.reload()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    <State loading={q.loading} error={q.error} empty={!q.data}>
      {q.data && <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Pending approvals" value={String(q.data.kpis.pendingApprovals)} detail="Submitted or pending approval" attention={q.data.kpis.pendingApprovals > 0} />
          <KpiCard label="Upcoming plans" value={String(q.data.kpis.totalUpcoming)} detail={`${q.data.kpis.approved} approved`} />
          <KpiCard label="Plans at risk" value={String(q.data.kpis.atRisk)} detail="Review or constrained availability" attention={q.data.kpis.atRisk > 0} />
          <KpiCard label="Missing receipts" value={String(q.data.kpis.noReceipts)} detail="Shortfall with no planned shipment" attention={q.data.kpis.noReceipts > 0} />
          <KpiCard label="Events without plans" value={String(q.data.kpis.unplannedEvents)} detail="Upcoming commercial events not yet covered" attention={q.data.kpis.unplannedEvents > 0} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Modeled opportunity margin" value={money.format(q.data.kpis.modeledOpportunityMargin)} detail="Future potential · not realized" />
          <KpiCard label="Ready opportunity margin" value={money.format(q.data.kpis.readyOpportunityMargin)} detail="Modeled margin with READY feasibility" />
          <KpiCard label="Constrained shortfall" value={units.format(q.data.kpis.constrainedShortfallUnits)} detail="Units across constrained plans" attention={q.data.kpis.constrainedShortfallUnits > 0} />
          <KpiCard label="Historical revenue at risk" value={money.format(q.data.kpis.historicalRevenueAtRisk)} detail="Observed where lost sales were recorded" attention={q.data.kpis.historicalRevenueAtRisk > 0} />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card><CardHeader><CardTitle>Planned promotions by month</CardTitle><CardDescription>Imported TPM plans plus app-authored plans served from Lakebase.</CardDescription></CardHeader><CardContent className="space-y-4">{q.data.monthlyPlans.map((m) => <div key={m.month} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-3"><span className="text-sm font-medium">{m.month}</span><Progress value={(m.count / maxMonth) * 100} /><span className="text-right text-sm">{m.count}</span></div>)}</CardContent></Card>
          <Card><CardHeader><CardTitle>Upcoming events without a plan</CardTitle><CardDescription>Event-level gaps that need commercial coverage.</CardDescription></CardHeader><CardContent><State loading={false} error={null} empty={!q.data.unplannedEvents.length}><div className="space-y-3">{q.data.unplannedEvents.slice(0,6).map((e) => <div key={String(e.event_id)} className="flex items-center justify-between gap-4 rounded-lg border p-3"><div><p className="font-medium">{String(e.event_name)}</p><p className="text-xs text-muted-foreground">{String(e.event_start_date).slice(0,10)} · {String(e.event_type).replaceAll('_',' ')}</p></div><Badge variant="secondary">Plan needed</Badge></div>)}</div></State></CardContent></Card>
        </div>
        <Card><CardHeader><CardTitle>Priority risk queue</CardTitle><CardDescription>Plans requiring availability review before approval.</CardDescription></CardHeader><CardContent><State loading={false} error={null} empty={!q.data.riskQueue.length}><Table><TableHeader><TableRow><TableHead>Promotion</TableHead><TableHead>Timing</TableHead><TableHead>Status</TableHead><TableHead>Risk</TableHead><TableHead className="text-right">Shortfall</TableHead></TableRow></TableHeader><TableBody>{q.data.riskQueue.map((p) => <TableRow key={p.plan_id}><TableCell className="font-medium">{p.product_name}<div className="text-xs text-muted-foreground">{p.cluster_name} · {p.event_name}</div></TableCell><TableCell>{String(p.start_date).slice(0,10)}</TableCell><TableCell><Badge variant={p.readiness_status === 'CONSTRAINED' ? 'destructive' : 'secondary'}>{p.readiness_status}</Badge></TableCell><TableCell>{humanRisk(p.risk_reason)}</TableCell><TableCell className="text-right">{units.format(Number(p.projected_shortfall_units))}</TableCell></TableRow>)}</TableBody></Table></State></CardContent></Card>
        <p className="text-xs text-muted-foreground">Sources: {q.data.freshness.plans}; {q.data.freshness.events}; {q.data.freshness.value}. Modeled future potential is not realized or causal impact.</p>
      </>}
    </State>
  </div>;
}

function PromotionHistoryPage() {
  const q = useApi<{ data: HistoricalPromotion[] }>('/api/promotion-history');
  const [category,setCategory]=useState('all'),[product,setProduct]=useState('all'),[market,setMarket]=useState('all'),[outcome,setOutcome]=useState('all');
  const all=q.data?.data??[];
  const options={categories:[...new Set(all.map(x=>x.category))].sort(),products:[...new Map(all.map(x=>[x.sku_id,x.product_name])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),markets:[...new Map(all.map(x=>[x.cluster_id,x.cluster_name])).entries()].sort((a,b)=>a[1].localeCompare(b[1]))};
  const rows=all.filter(x=>(category==='all'||x.category===category)&&(product==='all'||x.sku_id===product)&&(market==='all'||x.cluster_id===market)&&(outcome==='all'||x.success_classification===outcome));
  const successful=rows.filter(x=>x.success_classification.startsWith('SUCCESSFUL')||x.success_classification.startsWith('COMMERCIALLY_SUCCESSFUL')).length;
  const avg=(field:keyof HistoricalPromotion)=>rows.length?rows.reduce((s,r)=>s+Number(r[field]),0)/rows.length:0;
  return <div className="space-y-6"><div><h2 className="text-3xl font-semibold">Past Promotion Analysis</h2><p className="mt-2 text-sm text-muted-foreground">Learn from completed promotions using observational uplift, economics, and recorded availability outcomes.</p></div>
    <Card><CardContent className="grid gap-4 pt-6 md:grid-cols-4"><Field label="Category"><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{options.categories.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field><Field label="Product / SKU"><Select value={product} onValueChange={setProduct}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All products</SelectItem>{options.products.map(([id,name])=><SelectItem key={id} value={id}>{name} · {id}</SelectItem>)}</SelectContent></Select></Field><Field label="Market / cluster"><Select value={market} onValueChange={setMarket}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All markets</SelectItem>{options.markets.map(([id,name])=><SelectItem key={id} value={id}>{name} · {id}</SelectItem>)}</SelectContent></Select></Field><Field label="Outcome"><Select value={outcome} onValueChange={setOutcome}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All outcomes</SelectItem><SelectItem value="SUCCESSFUL_AND_AVAILABLE">Successful and available</SelectItem><SelectItem value="COMMERCIALLY_SUCCESSFUL_SUPPLY_CONSTRAINED">Successful, supply constrained</SelectItem><SelectItem value="VOLUME_GAIN_MARGIN_FAILURE">Volume gain, margin failure</SelectItem><SelectItem value="UNDERPERFORMING">Underperforming</SelectItem></SelectContent></Select></Field></CardContent></Card>
    <State loading={q.loading} error={q.error} empty={!rows.length}><>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><KpiCard label="Promotions analyzed" value={String(rows.length)} detail="Completed promotions in current view" /><KpiCard label="Success rate" value={`${rows.length?(successful/rows.length*100).toFixed(1):'0.0'}%`} detail="Positive margin and ROI" /><KpiCard label="Average uplift" value={`${avg('modeled_uplift_rate').toFixed(1)}%`} detail="Modeled observational uplift" /><KpiCard label="Average ROI" value={`${avg('promotion_roi').toFixed(2)}×`} detail="Incremental margin / trade spend" /><KpiCard label="Incremental margin" value={money.format(rows.reduce((s,r)=>s+Number(r.incremental_margin),0))} detail={`${units.format(rows.reduce((s,r)=>s+Number(r.lost_sales_units),0))} lost-sale units recorded`} /></div>
      <Card><CardHeader><CardTitle>Promotion results</CardTitle><CardDescription>Success requires positive margin and ROI; availability is reported separately.</CardDescription></CardHeader><CardContent><div className="max-h-[620px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Promotion</TableHead><TableHead>Timing</TableHead><TableHead className="text-right">Uplift</TableHead><TableHead className="text-right">ROI</TableHead><TableHead className="text-right">Incremental margin</TableHead><TableHead className="text-right">Lost sales</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader><TableBody>{rows.map(r=><TableRow key={r.promotion_id}><TableCell className="font-medium">{r.product_name}<div className="text-xs text-muted-foreground">{r.sku_id} · {r.cluster_name} · {r.mechanic}</div></TableCell><TableCell>{String(r.start_date).slice(0,10)}</TableCell><TableCell className="text-right">{Number(r.modeled_uplift_rate).toFixed(1)}%</TableCell><TableCell className="text-right">{Number(r.promotion_roi).toFixed(2)}×</TableCell><TableCell className="text-right">{money.format(Number(r.incremental_margin))}</TableCell><TableCell className="text-right">{units.format(Number(r.lost_sales_units))}</TableCell><TableCell><Badge variant={r.success_classification.includes('UNDERPERFORMING')||r.success_classification.includes('FAILURE')?'destructive':r.success_classification.includes('CONSTRAINED')?'secondary':'outline'}>{r.success_classification.replaceAll('_',' ')}</Badge></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
      <Alert><ShieldCheck className="h-4 w-4" />Uplift is a modeled observational comparison, not a causal treatment effect.</Alert>
    </></State></div>;
}

function UpcomingPromotionsPage() {
  const q=useApi<{data:PlannedPromotion[]}>('/api/upcoming-promotions');
  const [event,setEvent]=useState('all'),[status,setStatus]=useState('all'),[readiness,setReadiness]=useState('all'),[month,setMonth]=useState('all');
  const all=q.data?.data??[],months=[...new Set(all.map(p=>String(p.start_date).slice(0,7)))].sort(),events=[...new Map(all.map(p=>[p.event_id,{id:p.event_id,name:p.event_name,startDate:String(p.start_date)}])).values()].sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.name.localeCompare(b.name));
  const rows=all.filter(p=>(event==='all'||p.event_id===event)&&(status==='all'||p.plan_status===status)&&(readiness==='all'||p.readiness_status===readiness)&&(month==='all'||String(p.start_date).startsWith(month)));
  return <div className="space-y-6"><div className="flex items-end justify-between gap-4"><div><h2 className="text-3xl font-semibold">Upcoming Promotions</h2><p className="mt-2 text-sm text-muted-foreground">One operational view of imported TPM plans and PromoFlow-authored plans, with supply readiness.</p></div><Button variant="outline" onClick={()=>void q.reload()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    <Card><CardContent className="grid gap-4 pt-6 md:grid-cols-2 xl:grid-cols-4"><Field label="Commercial event"><Select value={event} onValueChange={setEvent}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All events</SelectItem>{events.map(v=><SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Approval status"><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{['DRAFT','PENDING_APPROVAL','SUBMITTED','APPROVED','REJECTED'].map(v=><SelectItem key={v} value={v}>{v.replaceAll('_',' ')}</SelectItem>)}</SelectContent></Select></Field><Field label="Availability readiness"><Select value={readiness} onValueChange={setReadiness}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All readiness states</SelectItem>{['READY','REVIEW','CONSTRAINED'].map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field><Field label="Start month"><Select value={month} onValueChange={setMonth}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All upcoming months</SelectItem>{months.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field></CardContent></Card>
    <State loading={q.loading} error={q.error} empty={!rows.length}><Card><CardHeader><CardTitle>{rows.length} planned promotions</CardTitle><CardDescription>Lakehouse plans are read-only synced references; app-authored plans remain native Lakebase records.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Promotion</TableHead><TableHead>Dates</TableHead><TableHead>Plan status</TableHead><TableHead>Availability</TableHead><TableHead>Risk reason</TableHead><TableHead className="text-right">Receipts</TableHead><TableHead className="text-right">Shortfall</TableHead></TableRow></TableHeader><TableBody>{rows.map(p=><TableRow key={`${p.source_system}-${p.plan_id}`}><TableCell className="font-medium">{p.product_name}<div className="text-xs text-muted-foreground">{p.sku_id} · {p.cluster_name} · {p.event_name}</div></TableCell><TableCell>{String(p.start_date).slice(0,10)}<div className="text-xs text-muted-foreground">to {String(p.end_date).slice(0,10)}</div></TableCell><TableCell><Badge variant="outline">{p.plan_status.replaceAll('_',' ')}</Badge></TableCell><TableCell><Badge variant={p.readiness_status==='CONSTRAINED'?'destructive':p.readiness_status==='REVIEW'?'secondary':'outline'}>{p.readiness_status}</Badge></TableCell><TableCell className="max-w-[240px]">{humanRisk(p.risk_reason)}</TableCell><TableCell className="text-right">{units.format(Number(p.planned_receipt_units))}</TableCell><TableCell className="text-right">{units.format(Number(p.projected_shortfall_units))}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></State>
    <Alert><Clock3 className="h-4 w-4" />Readiness is a point-in-time feasibility signal. It does not create shipments or inventory actions.</Alert>
  </div>;
}
function OpportunityInbox() {
  const q = useApi<{ data: Opportunity[] }>('/api/workbench/opportunities'),
    [search, setSearch] = useState(''),
    [eventFilter, setEventFilter] = useState('all'),
    [categoryFilter, setCategoryFilter] = useState('all'),
    [productFilter, setProductFilter] = useState('all'),
    [marketFilter, setMarketFilter] = useState('all'),
    navigate = useNavigate();
  const opportunities = q.data?.data ?? [];
  const options = useMemo(
    () => ({
      events: [...new Map(opportunities.map((o) => [o.event_name, o])).values()]
        .sort((a, b) => a.event_start_date.localeCompare(b.event_start_date)),
      categories: [...new Set(opportunities.map((o) => o.category))].sort(),
      products: [...new Map(opportunities.map((o) => [o.recommended_sku_id, o.recommended_product_name])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1])),
      markets: [...new Map(opportunities.map((o) => [o.cluster_id, o.cluster_name])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1])),
    }),
    [opportunities]
  );
  const rows = opportunities.filter((o) => {
    const matchesSearch = !search || `${o.event_name} ${o.category} ${o.recommended_product_name} ${o.cluster_name}`
      .toLowerCase().includes(search.toLowerCase());
    return matchesSearch &&
      (eventFilter === 'all' || o.event_name === eventFilter) &&
      (categoryFilter === 'all' || o.category === categoryFilter) &&
      (productFilter === 'all' || o.recommended_sku_id === productFilter) &&
      (marketFilter === 'all' || o.cluster_id === marketFilter);
  });
  const hasFilters = search || eventFilter !== 'all' || categoryFilter !== 'all' || productFilter !== 'all' || marketFilter !== 'all';
  const clearFilters = () => {
    setSearch(''); setEventFilter('all'); setCategoryFilter('all'); setProductFilter('all'); setMarketFilter('all');
  };
  const open = (o: Opportunity) => {
    const p = new URLSearchParams({
      opportunityId: o.opportunity_id,
      skuId: o.recommended_sku_id,
      clusterId: o.cluster_id,
      startDate: o.event_start_date.slice(0, 10),
      endDate: o.event_end_date.slice(0, 10),
      mechanic: o.recommended_mechanic,
      discountPct: String(Number(o.recommended_discount_pct) * 100),
      listPrice: String(o.list_price),
      unitCost: String(o.unit_cost),
    });
    void navigate(`/studio?${p}`);
  };
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Badge variant="outline" className="mb-2">
            Step 1 of 4
          </Badge>
          <h2 className="text-3xl font-semibold">Choose the next commercial opportunity</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Upcoming events joined to governed economics, historical evidence and model scores. Select an opportunity to
            test—not an AI-generated commitment.
          </p>
        </div>
        <Button variant="outline" onClick={() => void q.reload()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>Commercial event</Label>
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger><SelectValue placeholder="All events" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All events</SelectItem>
                  {options.events.map((o) => <SelectItem key={o.event_name} value={o.event_name}>{o.event_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {options.categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Product</Label>
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger><SelectValue placeholder="All products" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {options.products.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Market / cluster</Label>
              <Select value={marketFilter} onValueChange={setMarketFilter}>
                <SelectTrigger><SelectValue placeholder="All markets" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All markets</SelectItem>
                  {options.markets.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-end">
            <div className="w-full max-w-xl space-y-2">
              <Label htmlFor="search">Optional keyword search</Label>
              <Input id="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search event or product name" />
            </div>
            <div className="flex items-center gap-3 md:ml-auto">
              <p className="text-sm text-muted-foreground">{rows.length} of {opportunities.length} opportunities</p>
              <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters}>Clear filters</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <State loading={q.loading} error={q.error} empty={!rows.length}>
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.slice(0, 12).map((o) => (
            <Card key={o.opportunity_id} className="hover:shadow-md">
              <CardHeader>
                <div className="flex justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">
                      {o.event_name} · {o.category}
                    </CardTitle>
                    <CardDescription>
                      <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
                      {o.event_start_date.slice(0, 10)}–{o.event_end_date.slice(0, 10)}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      o.economics_status === 'AVOID'
                        ? 'destructive'
                        : o.economics_status === 'RECOMMENDED'
                          ? 'default'
                          : 'secondary'
                    }
                  >
                    {o.economics_status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{o.recommended_product_name}</p>
                <p className="text-sm text-muted-foreground">
                  {o.cluster_name} · {o.recommended_mechanic} · {(Number(o.recommended_discount_pct) * 100).toFixed(0)}%
                  discount
                </p>
                <div className="my-4 grid grid-cols-3 gap-3 rounded-lg bg-muted/60 p-3">
                  <Metric
                    label="Predicted uplift"
                    value={`${(Number(o.expected_modeled_uplift_pct) * 100).toFixed(1)}%`}
                  />
                  <Metric label="Incremental margin" value={money.format(o.expected_incremental_margin)} />
                  <Metric label="Promotion ROI" value={`${Number(o.expected_promotion_roi).toFixed(2)}×`} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {o.evidence_count} observations · {o.confidence_band.toLowerCase()} confidence · live UC analytics
                  </p>
                  <Button size="sm" onClick={() => open(o)}>
                    Build scenario
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </State>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function ScenarioStudio() {
  const [params] = useSearchParams();
  const opportunityQuery = useApi<{ data: Opportunity[] }>('/api/workbench/opportunities');
  const initial = useMemo<ScenarioInput>(
    () => ({
      opportunityId: params.get('opportunityId') ?? undefined,
      skuId: params.get('skuId') ?? 'SKU-001',
      clusterId: params.get('clusterId') ?? 'CL-01',
      startDate: params.get('startDate') ?? '2026-11-23',
      endDate: params.get('endDate') ?? '2026-11-29',
      mechanic: (params.get('mechanic') as Mechanic) ?? 'DISPLAY',
      discountPct: Number(params.get('discountPct') ?? 15),
      listPrice: Number(params.get('listPrice') ?? 12.99),
      unitCost: Number(params.get('unitCost') ?? 5.1),
      notes: '',
    }),
    [params]
  );
  const [form, setForm] = useState(initial),
    [previews, setPreviews] = useState<Preview[]>([]),
    [selectedPreviewKey, setSelectedPreviewKey] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [brief, setBrief] = useState<{
      narrative: string;
      model_service?: string;
      prompt_version?: string;
      generated_at?: string;
    } | null>(null),
    [savedScenarioId, setSavedScenarioId] = useState<string | null>(null);
  const opportunityRows = opportunityQuery.data?.data ?? [];
  const selectedOpportunity = opportunityRows.find((o) => o.opportunity_id === form.opportunityId);
  const eventRows = selectedOpportunity
    ? opportunityRows.filter((o) => o.event_name === selectedOpportunity.event_name)
    : opportunityRows;
  const productOptions = [...new Map(eventRows.map((o) => [o.recommended_sku_id, o.recommended_product_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const marketOptions = [...new Map(eventRows
    .filter((o) => o.recommended_sku_id === form.skuId)
    .map((o) => [o.cluster_id, o.cluster_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const patch = <K extends keyof ScenarioInput>(key: K, value: ScenarioInput[K]) => {
    setForm((c) => ({ ...c, [key]: value }));
    setSavedScenarioId(null);
    setBrief(null);
  };
  const applyOpportunity = (o: Opportunity) => {
    setForm((current) => ({
      ...current,
      opportunityId: o.opportunity_id,
      skuId: o.recommended_sku_id,
      clusterId: o.cluster_id,
      listPrice: Number(o.list_price),
      unitCost: Number(o.unit_cost),
    }));
    setPreviews([]);
    setSelectedPreviewKey(null);
    setSavedScenarioId(null);
    setBrief(null);
  };
  const selectProduct = (skuId: string) => {
    const next = eventRows.find((o) => o.recommended_sku_id === skuId && o.cluster_id === form.clusterId)
      ?? eventRows.find((o) => o.recommended_sku_id === skuId);
    if (next) applyOpportunity(next);
  };
  const selectMarket = (clusterId: string) => {
    const next = eventRows.find((o) => o.recommended_sku_id === form.skuId && o.cluster_id === clusterId);
    if (next) applyOpportunity(next);
  };
  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/scenarios/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }),
        b = (await r.json()) as Preview & { error?: string };
      if (!r.ok) throw new Error(b.error ?? 'Calculation failed');
      setPreviews((c) =>
        [b, ...c.filter((x) => x.mechanic !== b.mechanic || x.discountPct !== b.discountPct)].slice(0, 3)
      );
      setSelectedPreviewKey(previewKey(b));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calculation failed');
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    if (!savedScenarioId) {
      setError('Save the selected scenario before generating its governed decision brief.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/scenarios/${encodeURIComponent(savedScenarioId)}/decision-brief`, {
          method: 'POST',
        }),
        b = (await r.json()) as typeof brief & { error?: string };
      if (!r.ok || !b?.narrative) throw new Error(b?.error ?? 'Brief failed');
      setBrief(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Brief failed');
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!best) {
      setError('Calculate a scenario before saving it.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(best),
        }),
        b = (await r.json()) as { scenarioId?: string; error?: string };
      if (!r.ok || !b.scenarioId) throw new Error(b.error ?? 'Could not save scenario');
      setSavedScenarioId(b.scenarioId);
      setBrief(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save scenario');
    } finally {
      setBusy(false);
    }
  };
  const best = previews.find((p) => previewKey(p) === selectedPreviewKey) ?? previews[0],
    available = best ? Math.max(0, best.predictedPromotionUnits - best.inventoryGapUnits) : 0,
    coverage = best?.predictedPromotionUnits ? Math.min(100, (available / best.predictedPromotionUnits) * 100) : 0;
  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline" className="mb-2">
          Steps 2–3 of 4
        </Badge>
        <h2 className="text-3xl font-semibold">Scenario Studio</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Edit commercial levers, compare modeled economics, then check whether supply can support demand. Availability
          informs the decision; it creates no actions.
        </p>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Scenario inputs</CardTitle>
            <CardDescription>Editable assumptions; calculations run server-side.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Product / SKU">
              <Select value={form.skuId} onValueChange={selectProduct} disabled={opportunityQuery.loading}>
                <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Choose a product" /></SelectTrigger>
                <SelectContent>
                  {productOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name} · {id}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Market / cluster">
              <Select value={form.clusterId} onValueChange={selectMarket} disabled={opportunityQuery.loading}>
                <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Choose a market" /></SelectTrigger>
                <SelectContent>
                  {marketOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name} · {id}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Mechanic">
              <Select value={form.mechanic} onValueChange={(v) => patch('mechanic', v as Mechanic)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['TPR', 'FEATURE', 'DISPLAY', 'FEATURE_DISPLAY', 'BOGO'].map((v) => (
                    <SelectItem value={v} key={v}>
                      {v.replace('_', ' + ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Discount %">
              <Input
                type="number"
                value={form.discountPct}
                onChange={(e) => patch('discountPct', Number(e.target.value))}
              />
            </Field>
            <Field label="Start date">
              <Input type="date" value={form.startDate} onChange={(e) => patch('startDate', e.target.value)} />
            </Field>
            <Field label="End date">
              <Input type="date" value={form.endDate} onChange={(e) => patch('endDate', e.target.value)} />
            </Field>
            <Field label="List price · governed">
              <Input value={money.format(form.listPrice)} readOnly className="bg-muted/50" />
            </Field>
            <Field label="Unit cost · governed">
              <Input value={money.format(form.unitCost)} readOnly className="bg-muted/50" />
            </Field>
            <Field label="Planner note">
              <Input value={form.notes} onChange={(e) => patch('notes', e.target.value)} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button onClick={() => void preview()} disabled={busy}>
                {busy ? 'Calculating…' : 'Calculate and add to comparison'}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex gap-2">
              <Boxes className="h-5 w-5" />
              Availability check
            </CardTitle>
            <CardDescription>On-hand + inbound − commitments − safety stock.</CardDescription>
          </CardHeader>
          <CardContent>
            {best ? (
              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span>Availability coverage</span>
                  <strong>{coverage.toFixed(0)}%</strong>
                </div>
                <Progress value={coverage} />
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Expected demand" value={units.format(best.predictedPromotionUnits)} />
                  <Metric label="Available units" value={units.format(available)} />
                  <Metric label="Potential shortfall" value={units.format(best.inventoryGapUnits)} />
                  <Metric label="Status" value={best.inventoryGapUnits > 0 ? 'Constrained' : 'Ready'} />
                </div>
                <div className="w-full rounded-lg border bg-muted/30 px-4 py-3 text-sm leading-6">
                  {best.inventoryGapUnits > 0
                    ? 'Review shortfall before approval. No replenishment action will be created.'
                    : 'Current supply projection supports this scenario.'}
                </div>
                <p className="text-xs text-muted-foreground">
                  Point-in-time feasibility · verify freshness and inbound certainty.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Calculate a scenario to see feasibility.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Side-by-side comparison</CardTitle>
          <CardDescription>Change the levers and calculate again to compare up to three alternatives.</CardDescription>
        </CardHeader>
        <CardContent>
          <State loading={false} error={null} empty={!previews.length}>
            <div className="grid gap-4 lg:grid-cols-3">
              {previews.map((p) => {
                const selected = best ? previewKey(p) === previewKey(best) : false;
                return (
                <div
                  className={`rounded-lg border p-4 transition-colors ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-foreground/30'}`}
                  key={previewKey(p)}
                >
                  <div className="flex justify-between">
                    <p className="font-semibold">{p.mechanic.replace('_', ' + ')}</p>
                    {selected && <Badge>Selected</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{p.discountPct}% discount</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Metric label="Uplift" value={`${(p.modeledUpliftPct * 100).toFixed(1)}%`} />
                    <Metric label="Promo units" value={units.format(p.predictedPromotionUnits)} />
                    <Metric label="Incremental margin" value={money.format(p.estimatedIncrementalMargin)} />
                    <Metric label="ROI" value={`${p.estimatedPromotionRoi.toFixed(2)}×`} />
                  </div>
                  <Button
                    className="mt-4 w-full"
                    size="sm"
                    variant={selected ? 'secondary' : 'outline'}
                    onClick={() => {
                      setSelectedPreviewKey(previewKey(p));
                      setSavedScenarioId(null);
                      setBrief(null);
                    }}
                  >
                    {selected ? 'Selected scenario' : 'Select this scenario'}
                  </Button>
                </div>
                );
              })}
            </div>
          </State>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex justify-between gap-4">
            <div>
              <CardTitle className="flex gap-2">
                <Sparkles className="h-5 w-5" />
                AI Decision Brief
              </CardTitle>
              <CardDescription>
                Unity Gateway explains and challenges facts; it does not calculate or approve.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void save()} disabled={busy || !best}>
                {savedScenarioId ? 'Draft saved' : 'Save selected draft'}
              </Button>
              <Button onClick={() => void generate()} disabled={busy || !savedScenarioId}>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate brief
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {brief ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Badge>Unity Gateway AI</Badge>
                <Badge variant="outline">{brief.model_service ?? 'promo_decision_brief'}</Badge>
                <Badge variant="outline">Prompt {brief.prompt_version ?? 'v1'}</Badge>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-6">{brief.narrative}</div>
              <p className="text-xs text-muted-foreground">
                Sources: model scores, event calendar, economics, availability · AI-generated — verify before approval
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Generate after comparing scenarios. The brief is stored with model and prompt provenance.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function DecisionWorkspace() {
  const q = useApi<Decision[]>('/api/decisions');
  const update = async (id: string, status: 'SUBMITTED' | 'APPROVED' | 'REJECTED') => {
    await fetch(`/api/decisions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await q.reload();
  };
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <div>
          <Badge variant="outline" className="mb-2">
            Step 4 of 4
          </Badge>
          <h2 className="text-3xl font-semibold">Decision Workspace</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Human-controlled workflow with immutable versions, AI briefs and audit events in Lakebase.
          </p>
        </div>
        <Button variant="outline" onClick={() => void q.reload()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          <State loading={q.loading} error={q.error} empty={!q.data?.length}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Economics</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data?.map((d) => (
                  <TableRow key={d.decision_id}>
                    <TableCell className="font-medium">
                      {d.sku_id} · {d.cluster_id}
                      <div className="text-xs text-muted-foreground">
                        {d.promotion_mechanic} · {Number(d.discount_pct).toFixed(0)}%
                      </div>
                    </TableCell>
                    <TableCell>
                      {money.format(Number(d.estimated_incremental_margin))}
                      <div className="text-xs text-muted-foreground">
                        {Number(d.estimated_promotion_roi).toFixed(2)}× ROI
                      </div>
                    </TableCell>
                    <TableCell>
                      {Number(d.potential_shortfall_units) > 0 ? (
                        <Badge variant="destructive">{units.format(Number(d.potential_shortfall_units))} short</Badge>
                      ) : (
                        <Badge variant="outline">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Ready
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === 'REJECTED' ? 'destructive' : d.status === 'APPROVED' ? 'default' : 'secondary'
                        }
                      >
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => void update(d.decision_id, 'SUBMITTED')}>
                          Submit
                        </Button>
                        <Button size="sm" onClick={() => void update(d.decision_id, 'APPROVED')}>
                          Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void update(d.decision_id, 'REJECTED')}>
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </State>
        </CardContent>
      </Card>
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        Approval records the commercial decision only. PromoFlow does not autonomously commit spend or create supply
        actions.
      </Alert>
    </div>
  );
}
function GeniePage() {
  const me = useApi<Identity>('/api/whoami');
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-semibold">Ask PromoFlow</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Explore governed promotion evidence without changing decisions.
        </p>
      </div>
      <div className="flex gap-2">
        <Badge variant="outline">Signed in as {me.data?.email ?? me.data?.user ?? 'current user'}</Badge>
        <Badge variant="secondary">AI-generated — verify</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Promotion data assistant</CardTitle>
          <CardDescription>Query attachments expose generated SQL and source results.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[650px] overflow-hidden rounded-lg border">
            <GenieChat alias="default" />
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Genie answers are guidance, not approvals. Inspect generated SQL and freshness before acting.
      </p>
    </div>
  );
}
const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: OverviewPage },
      { path: 'opportunities', Component: OpportunityInbox },
      { path: 'history', Component: PromotionHistoryPage },
      { path: 'upcoming', Component: UpcomingPromotionsPage },
      { path: 'studio', Component: ScenarioStudio },
      { path: 'decisions', Component: DecisionWorkspace },
      { path: 'genie', Component: GeniePage },
    ],
  },
]);
export default function App() {
  return <RouterProvider router={router} />;
}
