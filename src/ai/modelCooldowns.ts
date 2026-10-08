/**
 * FILE: ai/modelCooldowns.ts
 * WHAT: Remembers which Gemini models are "resting" (rate-limited, overloaded, or missing) and until when,
 *       and turns a failed HTTP reply into how long that model should rest.
 * CALLED BY: ai/gemini.ts
 * NOTE: kept in memory only. If the service worker restarts we simply re-try a model once,
 *       get the same 429 (which costs no quota) and mark it again.
 */
import {
  GEMINI_BAD_REQUEST_COOLDOWN_MS, GEMINI_BUSY_COOLDOWN_MS, GEMINI_MISSING_MODEL_COOLDOWN_MS,
  GEMINI_PER_MINUTE_COOLDOWN_MS,
} from '../config';

const restingUntil = new Map<string, number>();

export function isResting(model: string, now = Date.now()): boolean {
  return (restingUntil.get(model) ?? 0) > now;
}

export function restModel(model: string, milliseconds: number): void {
  restingUntil.set(model, Date.now() + milliseconds);
}

/** Milliseconds until the first model in the list is usable again (0 if one is usable now). */
export function msUntilAnyModelReady(models: string[], now = Date.now()): number {
  const waits = models.map((model) => Math.max(0, (restingUntil.get(model) ?? 0) - now));
  return waits.length === 0 ? 0 : Math.min(...waits);
}

/** For the UI / logs: "gemini-3.5-flash rests 12 min". */
export function describeRestingModels(models: string[], now = Date.now()): string[] {
  return models.filter((model) => isResting(model, now))
    .map((model) => `${model} rests ${Math.ceil(((restingUntil.get(model) ?? now) - now) / 60_000)} min`);
}

/** Google's free-tier daily limits reset at midnight Pacific time. */
export function msUntilPacificMidnight(now = new Date()): number {
  const pacificNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const pacificMidnight = new Date(pacificNow);
  pacificMidnight.setHours(24, 0, 0, 0);
  return pacificMidnight.getTime() - pacificNow.getTime();
}

export type FailureKind = 'rate_limit_day' | 'rate_limit_minute' | 'busy' | 'missing_model' | 'bad_request' | 'bad_key';

/** Reads the status code and error text Gemini sent back and decides what kind of failure it was. */
export function classifyFailure(status: number, bodyText: string): FailureKind {
  if (/api key not valid|api_key_invalid|invalid api key|unregistered callers/i.test(bodyText)) return 'bad_key';
  if (status === 429) return /per ?day|perday|daily/i.test(bodyText) ? 'rate_limit_day' : 'rate_limit_minute';
  if (status === 404) return 'missing_model';
  if (status === 401) return 'bad_key';
  if (status >= 500 || status === 0) return 'busy';
  return 'bad_request'; // 400 / 403 that is not about the key: this model doesn't accept our request
}

/** How long a model should rest after this kind of failure. */
export function cooldownFor(kind: FailureKind, bodyText: string): number {
  if (kind === 'rate_limit_day') return msUntilPacificMidnight();
  if (kind === 'rate_limit_minute') {
    // Google usually says exactly how long to wait, e.g. "retryDelay": "37s".
    const retrySeconds = bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)?.[1];
    return retrySeconds ? Math.ceil(Number(retrySeconds) * 1000) + 1_000 : GEMINI_PER_MINUTE_COOLDOWN_MS;
  }
  if (kind === 'missing_model') return GEMINI_MISSING_MODEL_COOLDOWN_MS;
  if (kind === 'busy') return GEMINI_BUSY_COOLDOWN_MS;
  return GEMINI_BAD_REQUEST_COOLDOWN_MS;
}
