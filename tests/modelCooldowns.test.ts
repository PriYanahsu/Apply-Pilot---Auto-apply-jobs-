/**
 * FILE: tests/modelCooldowns.test.ts
 * WHAT: Gemini fallback decisions: what kind of failure, how long the model rests.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyFailure, cooldownFor, isResting, msUntilAnyModelReady, msUntilPacificMidnight, restModel,
} from '../src/ai/modelCooldowns';

describe('classifyFailure', () => {
  it('tells daily and per-minute rate limits apart', () => {
    expect(classifyFailure(429, '{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}')).toBe('rate_limit_day');
    expect(classifyFailure(429, '{"quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}')).toBe('rate_limit_minute');
  });
  it('recognises busy, missing, bad key and bad request', () => {
    expect(classifyFailure(503, 'high demand')).toBe('busy');
    expect(classifyFailure(0, 'network/timeout')).toBe('busy');
    expect(classifyFailure(404, 'no longer available to new users')).toBe('missing_model');
    expect(classifyFailure(400, 'API key not valid. Please pass a valid API key.')).toBe('bad_key');
    expect(classifyFailure(400, 'JSON mode is not enabled for this model')).toBe('bad_request');
  });
});

describe('cooldownFor', () => {
  it("uses Google's retryDelay for per-minute limits", () => {
    expect(cooldownFor('rate_limit_minute', '"retryDelay": "37s"')).toBe(38_000);
    expect(cooldownFor('rate_limit_minute', 'no hint')).toBe(60_000);
  });
  it('rests a daily-limited model until Pacific midnight', () => {
    const wait = cooldownFor('rate_limit_day', '');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(msUntilPacificMidnight(new Date('2026-10-08T06:00:00Z'))).toBe(1 * 60 * 60 * 1000); // 23:00 PDT -> 1 h
  });
});

describe('resting models', () => {
  it('skips a resting model and reports when the next one is ready', () => {
    restModel('model-a', 30_000);
    expect(isResting('model-a')).toBe(true);
    expect(isResting('model-b')).toBe(false);
    expect(msUntilAnyModelReady(['model-a', 'model-b'])).toBe(0);
    expect(msUntilAnyModelReady(['model-a'])).toBeGreaterThan(29_000);
  });
});
