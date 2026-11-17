import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PROMOTION_NARRATIVE_PROMPT_VERSION = 'promotion-decision-brief-v2';
export type PromotionNarrativeFacts = {
  opportunityId: string; eventName: string; eventStartDate: string; eventEndDate: string;
  category: string; productName: string; clusterName: string; mechanic: string; discountPct: number;
  expectedUpliftPct: number; expectedIncrementalMargin: number; expectedPromotionRoi: number;
  historicalIncrementalMargin?: number; historicalPromotionRoi?: number; evidenceCount?: number;
  confidenceBand?: string; predictedPromotionUnits?: number; feasibilityStatus?: string;
  availabilityCoveragePct?: number | null; potentialShortfallUnits?: number;
  availabilityAsOf?: string; sourceRefs?: Record<string, unknown>;
};
export const DecisionBrief = z.object({
  executiveRecommendation: z.string().min(1),
  supportingEvidence: z.array(z.string()).min(1).max(5),
  assumptionsAndUncertainties: z.array(z.string()).min(1).max(5),
  commercialRisks: z.array(z.string()).min(1).max(5),
  validationQuestions: z.array(z.string()).min(1).max(5),
  suggestedNextAction: z.string().min(1),
});
export type DecisionBriefContent = z.infer<typeof DecisionBrief>;
type GatewayResponse = {
  output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }>;
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  predictions?: GatewayResponse[]; response?: GatewayResponse; data?: GatewayResponse;
  usage?: Record<string, unknown>; id?: string;
};
export function promotionNarrativeFingerprint(facts: PromotionNarrativeFacts) {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}
export function buildPromotionNarrativePrompt(facts: PromotionNarrativeFacts) {
  return `Create a concise decision brief for a CPG promotion planner using only the supplied facts.
Return valid JSON with exactly these keys: executiveRecommendation (string), supportingEvidence (string array), assumptionsAndUncertainties (string array), commercialRisks (string array), validationQuestions (string array), suggestedNextAction (string).
Quantify promotion economics and describe availability only as a point-in-time feasibility constraint. Do not prescribe replenishment, transfers, expedites, supplier tasks, or autonomous actions. Do not discuss inventory, supply chain actions beyond this feasibility constraint. Do not invent numbers, causal claims, customer names, or facts. Explicitly call out uncertainty and source freshness. The human planner owns the decision.
Facts: ${JSON.stringify(facts)}`;
}
export function extractGatewayText(response: GatewayResponse): string {
  const content = response.choices?.[0]?.message?.content;
  const chat = typeof content === 'string' ? content.trim() : content?.map((x) => x.text ?? '').join('').trim();
  if (chat) return chat;
  if (response.output_text?.trim()) return response.output_text.trim();
  for (const item of response.output ?? []) for (const block of item.content ?? []) if (block.text?.trim()) return block.text.trim();
  for (const nested of [...(response.predictions ?? []), response.response, response.data])
    if (nested) try { return extractGatewayText(nested); } catch { /* inspect next wrapper */ }
  throw new Error(`Unity Gateway returned no text (keys: ${Object.keys(response).sort().join(',')})`);
}
export function parseDecisionBrief(text: string): DecisionBriefContent {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return DecisionBrief.parse(JSON.parse(cleaned));
}
async function getAppToken() {
  const host = process.env.DATABRICKS_HOST?.replace(/^(?!https?:\/\/)/, 'https://').replace(/\/$/, '');
  const clientId = process.env.DATABRICKS_CLIENT_ID, clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!host || !clientId || !clientSecret) throw new Error('Databricks app credentials are unavailable');
  const response = await fetch(`${host}/oidc/v1/token`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=all-apis',
  });
  if (!response.ok) throw new Error(`Databricks OAuth request failed (${response.status})`);
  return ((await response.json()) as { access_token: string }).access_token;
}
export async function generatePromotionNarrative(facts: PromotionNarrativeFacts) {
  const host = process.env.DATABRICKS_HOST?.replace(/^(?!https?:\/\/)/, 'https://').replace(/\/$/, '');
  const modelService = process.env.PROMOTION_NARRATIVE_MODEL_SERVICE;
  if (!host || !modelService) throw new Error('Unity Gateway model service is not configured');
  const requestTags = { solution: 'promoflow-ai', feature: 'promotion-decision-brief', prompt_version: PROMOTION_NARRATIVE_PROMPT_VERSION };
  const startedAt = Date.now();
  const response = await fetch(`${host}/ai-gateway/mlflow/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${await getAppToken()}`, 'Content-Type': 'application/json', 'Databricks-Ai-Gateway-Request-Tags': JSON.stringify(requestTags) },
    body: JSON.stringify({ model: modelService, messages: [
      { role: 'system', content: 'You are a careful CPG revenue-growth analyst. Ground every claim in supplied facts and emit JSON only.' },
      { role: 'user', content: buildPromotionNarrativePrompt(facts) },
    ], max_tokens: 1000, response_format: { type: 'json_object' } }),
  });
  if (!response.ok) throw new Error(`Unity Gateway inference failed (${response.status})`);
  const payload = (await response.json()) as GatewayResponse;
  const rawText = extractGatewayText(payload);
  return { narrative: rawText, brief: parseDecisionBrief(rawText), modelService,
    promptVersion: PROMOTION_NARRATIVE_PROMPT_VERSION, inputFingerprint: promotionNarrativeFingerprint(facts),
    responseId: payload.id ?? null, usage: payload.usage ?? {}, requestTags, latencyMs: Date.now() - startedAt };
}
