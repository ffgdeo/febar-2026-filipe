import { describe, expect, test } from 'vitest';
import {
  buildPromotionNarrativePrompt,
  extractGatewayText,
  promotionNarrativeFingerprint,
} from '../server/unity-gateway/promotion-narrative';

const facts = {
  opportunityId: 'OPP-1',
  eventName: 'Black Friday',
  eventStartDate: '2026-11-23',
  eventEndDate: '2026-11-29',
  category: 'Laundry',
  productName: 'FreshWave Laundry Liquid',
  clusterName: 'West Coast',
  mechanic: 'DISPLAY',
  discountPct: 11.66,
  expectedUpliftPct: 20.3,
  expectedIncrementalMargin: 3484.82,
  expectedPromotionRoi: 1.0641,
  historicalIncrementalMargin: 1290.44,
  historicalPromotionRoi: 0.81,
  evidenceCount: 3,
  confidenceBand: 'HIGH',
};

describe('grounded promotion narratives', () => {
  test('prompt contains governed facts and excludes supply-chain recommendations', () => {
    const prompt = buildPromotionNarrativePrompt(facts);
    expect(prompt).toContain('3484.82');
    expect(prompt).toContain('Do not discuss inventory, supply chain');
    expect(prompt).toContain('Do not invent numbers');
  });

  test('fingerprint changes with the governed inputs', () => {
    expect(promotionNarrativeFingerprint(facts)).not.toBe(promotionNarrativeFingerprint({ ...facts, discountPct: 12 }));
  });

  test('extracts unified Responses API text', () => {
    expect(extractGatewayText({ output: [{ content: [{ text: 'Grounded rationale.' }] }] })).toBe(
      'Grounded rationale.'
    );
  });

  test('extracts unified Chat Completions text', () => {
    expect(extractGatewayText({ choices: [{ message: { content: 'Grounded chat rationale.' } }] })).toBe(
      'Grounded chat rationale.'
    );
  });

  test('extracts a model-serving compatibility wrapper', () => {
    expect(extractGatewayText({ predictions: [{ choices: [{ message: { content: 'Wrapped rationale.' } }] }] })).toBe(
      'Wrapped rationale.'
    );
  });

  test('extracts structured chat content returned to an app service principal', () => {
    expect(extractGatewayText({ choices: [{ message: { content: [{ text: 'Structured rationale.' }] } }] })).toBe(
      'Structured rationale.'
    );
  });
});
