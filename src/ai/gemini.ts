/**
 * FILE: ai/gemini.ts
 * WHAT: The only code that talks to Gemini. askGemini() sends one prompt, forces JSON output,
 *       validates the reply with Zod, and logs it to aiCalls in debug mode.
 *       MODEL FALLBACK: settings.geminiModels is tried in order. When a model hits its rate limit,
 *       is overloaded, or isn't available, it "rests" (ai/modelCooldowns.ts) and the next model is used,
 *       so a single model's limit never fails the request.
 * CALLED BY: steps/2-buildProfile.ts (P1), steps/6-scoreJobs.ts (P2), steps/8-answerScreening.ts (P3), background (key test)
 * RETURNS: the parsed, validated JSON. Throws an Error with .code = 'GEMINI_QUOTA' (every model resting -> run pauses),
 *          'GEMINI_INVALID' (bad JSON twice) or 'GEMINI_HTTP' (bad key / every model rejected the request).
 * IF IT BREAKS: Debug > Logs (step "gemini") shows each fallback; Debug > AI calls shows which model answered.
 */
import type { z } from 'zod';
import {
  GEMINI_BASE_URL, GEMINI_BUSY_RETRY_DELAY_MS, GEMINI_MAX_WAIT_FOR_MODEL_MS, GEMINI_MAX_WAIT_ROUNDS,
  GEMINI_TEMPERATURE, GEMINI_TIMEOUT_MS,
} from '../config';
import { db, getSettings } from '../db/database';
import { makeError } from '../shared/errors';
import { log } from '../shared/log';
import { sleep } from '../shared/sleep';
import {
  classifyFailure, cooldownFor, describeRestingModels, isResting, msUntilAnyModelReady, restModel, type FailureKind,
} from './modelCooldowns';

export interface GeminiPrompt<T> {
  promptName: string;
  system: string;
  user: string;
  responseSchema: object;  // Gemini's OpenAPI-style schema (must match zodSchema)
  zodSchema: z.ZodType<T>;
}

type ModelAttempt = { ok: true; text: string } | { ok: false; status: number; bodyText: string };

/** One HTTP call to one model, with a timeout. Network errors and timeouts come back as status 0. */
async function postToModel(apiKey: string, model: string, body: object): Promise<ModelAttempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status, bodyText: await response.text() };
    const json = await response.json();
    // Thinking models may add "thought" parts; only the real answer parts are JSON.
    const parts: { text?: string; thought?: boolean }[] = json?.candidates?.[0]?.content?.parts ?? [];
    return { ok: true, text: parts.filter((part) => !part.thought).map((part) => part.text ?? '').join('') };
  } catch (error) {
    return { ok: false, status: 0, bodyText: `network/timeout: ${String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Tries one model; a busy/network failure gets one quick retry before we give up on it. */
async function tryModel(apiKey: string, model: string, body: object): Promise<ModelAttempt> {
  const first = await postToModel(apiKey, model, body);
  if (first.ok || classifyFailure(first.status, first.bodyText) !== 'busy') return first;
  await sleep(GEMINI_BUSY_RETRY_DELAY_MS);
  return postToModel(apiKey, model, body);
}

interface FallbackResult {
  text: string;
  model: string;
}

/** Walks the model list until one answers. Waits briefly if every model is only resting for a minute. */
async function callWithFallback(apiKey: string, models: string[], body: object, promptName: string, jobId?: string): Promise<FallbackResult> {
  const failureKinds: FailureKind[] = [];
  for (let round = 0; round <= GEMINI_MAX_WAIT_ROUNDS; round += 1) {
    for (const model of models) {
      if (isResting(model)) continue;
      const attempt = await tryModel(apiKey, model, body);
      if (attempt.ok) return { text: attempt.text, model };

      const kind = classifyFailure(attempt.status, attempt.bodyText);
      if (kind === 'bad_key') throw makeError('GEMINI_HTTP', `Gemini rejected the API key (HTTP ${attempt.status}). Check it in the Setup tab.`);
      failureKinds.push(kind);
      const cooldownMs = cooldownFor(kind, attempt.bodyText);
      restModel(model, cooldownMs);
      await log('gemini', `${promptName}: ${model} failed (${kind}, HTTP ${attempt.status}) - resting ${Math.ceil(cooldownMs / 1000)} s, trying next model`, { jobId, level: 'warn', data: attempt.bodyText.slice(0, 300) });
    }
    const waitMs = msUntilAnyModelReady(models);
    if (waitMs > GEMINI_MAX_WAIT_FOR_MODEL_MS || round === GEMINI_MAX_WAIT_ROUNDS) break;
    await log('gemini', `${promptName}: every model is resting; waiting ${Math.ceil(waitMs / 1000)} s for the first one`, { jobId, level: 'warn' });
    await sleep(waitMs);
  }

  const resting = describeRestingModels(models).join('; ');
  const onlyBadRequests = failureKinds.length > 0 && failureKinds.every((kind) => kind === 'bad_request' || kind === 'missing_model');
  if (onlyBadRequests) throw makeError('GEMINI_HTTP', `No Gemini model accepted the request. ${resting}`);
  throw makeError('GEMINI_QUOTA', `All Gemini models are rate-limited or busy. ${resting}. Press Resume later.`);
}

export async function askGemini<T>(prompt: GeminiPrompt<T>, jobId?: string): Promise<T> {
  const settings = await getSettings();
  if (!settings.geminiApiKey) throw makeError('GEMINI_NO_KEY', 'No Gemini API key. Add it in the Setup tab.');
  const body = {
    systemInstruction: { parts: [{ text: prompt.system }] },
    contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
    generationConfig: { temperature: GEMINI_TEMPERATURE, responseMimeType: 'application/json', responseSchema: prompt.responseSchema },
  };

  // Invalid JSON gets exactly one more try (§7), then the caller marks the item failed.
  for (let validationAttempt = 1; validationAttempt <= 2; validationAttempt += 1) {
    const { text, model } = await callWithFallback(settings.geminiApiKey, settings.geminiModels, body, prompt.promptName, jobId);
    const result = prompt.zodSchema.safeParse(parseJson(text));
    if (settings.debugMode) await saveAiCall(prompt, model, text, result.success ? result.data : result.error.issues, jobId);
    if (result.success) return result.data;
    await log('gemini', `${prompt.promptName} (${model}) returned invalid JSON (attempt ${validationAttempt})`, { jobId, level: 'warn', data: result.error.issues.slice(0, 3) });
  }
  throw makeError('GEMINI_INVALID', `Gemini returned invalid JSON for ${prompt.promptName} twice`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('[gemini] reply was not JSON', error);
    return null; // Zod will reject null and trigger the retry
  }
}

async function saveAiCall(prompt: GeminiPrompt<unknown>, model: string, rawResponse: string, parsed: unknown, jobId?: string): Promise<void> {
  await db.aiCalls.add({
    ts: new Date().toISOString(), jobId, promptName: prompt.promptName, model,
    prompt: `SYSTEM:\n${prompt.system}\n\nUSER:\n${prompt.user}`,
    rawResponse, parsed: JSON.stringify(parsed, null, 2),
  });
}

export interface ModelTestResult {
  model: string;
  ok: boolean;
  message: string;
}

/** Setup tab "Test" button: one tiny JSON call per model, so you can see which ones work for your key. */
export async function testGeminiModels(apiKey: string, models: string[]): Promise<ModelTestResult[]> {
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Reply with {"ok": true}' }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] } },
  };
  const results: ModelTestResult[] = [];
  for (const model of models) {
    const attempt = await postToModel(apiKey, model, body);
    if (attempt.ok) {
      results.push({ model, ok: true, message: 'works' });
      continue;
    }
    const kind = classifyFailure(attempt.status, attempt.bodyText);
    results.push({ model, ok: false, message: `${kind} (HTTP ${attempt.status})` });
    if (kind === 'bad_key') break; // same answer for every model
  }
  return results;
}
