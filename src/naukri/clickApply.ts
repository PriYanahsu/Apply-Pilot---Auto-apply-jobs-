/**
 * FILE: naukri/clickApply.ts
 * WHAT: Clicks the Apply button on a job page, then watches what the page does.
 *       IMPORTANT: this only tells the background what probably happened (chatbot opened, page changed...).
 *       A job is counted as applied ONLY after the background reloads the page and Naukri's button says
 *       "Applied" (steps/8-applyToJob.ts -> confirmAppliedOnNaukri).
 * CALLED BY: entrypoints/naukri.content.ts (commands CLICK_APPLY and DETECT_APPLY_RESULT)
 * RETURNS: detectApplyResult -> 'applied' | 'chatbot' | 'external' | 'daily_limit' | 'unknown'
 * IF IT BREAKS: "Apply button not found" -> SEL.applyButton; stuck on 'unknown' -> SEL.applySuccess / chatDrawer.
 */
import { APPLY_SUCCESS_TEXTS, BUTTON_TEXT, DAILY_LIMIT_TEXTS } from './selectors';
import {
  findButtonByText, humanClick, makeError, pageTextIncludes, queryVisible, waitForCondition,
} from './domHelpers';
import type { ApplyResult } from '../shared/messages';

// Text that was already on the page BEFORE we clicked can't be proof that our click worked.
let successTextBeforeClick = false;
let limitTextBeforeClick = false;

export async function clickApply(): Promise<{ clicked: true }> {
  const button = queryVisible(document, 'applyButton') ?? findButtonByText(BUTTON_TEXT.apply, true);
  if (!button) throw makeError('SELECTOR_MISSING', 'Apply button not found', 'applyButton');
  successTextBeforeClick = pageTextIncludes(APPLY_SUCCESS_TEXTS);
  limitTextBeforeClick = pageTextIncludes(DAILY_LIMIT_TEXTS);
  await humanClick(button);
  return { clicked: true };
}

/** One look at the page. Returns null while nothing has visibly changed yet. */
function checkApplyResultNow(): ApplyResult | null {
  if (!limitTextBeforeClick && pageTextIncludes(DAILY_LIMIT_TEXTS)) return { result: 'daily_limit', detail: 'Naukri daily apply limit message' };
  // Naukri opens the chatbot drawer 1-2 s after clicking Apply when the recruiter added questions.
  if (queryVisible(document, 'chatDrawer')) return { result: 'chatbot', detail: 'Screening questions drawer opened' };
  if (queryVisible(document, 'alreadyApplied') || findButtonByText(BUTTON_TEXT.applied, true)) {
    return { result: 'applied', detail: 'Button changed to Applied' };
  }
  if (!successTextBeforeClick && (queryVisible(document, 'applySuccess') || pageTextIncludes(APPLY_SUCCESS_TEXTS))) {
    return { result: 'applied', detail: 'Success message appeared' };
  }
  if (!location.hostname.endsWith('naukri.com')) return { result: 'external', detail: `Redirected to ${location.hostname}` };
  return null;
}

export async function detectApplyResult(timeoutMs: number): Promise<ApplyResult> {
  try {
    return await waitForCondition(checkApplyResultNow, timeoutMs, 'No apply result yet');
  } catch (error) {
    // A timeout is a normal outcome ("nothing visible changed"); the background re-checks by reloading.
    console.log('[clickApply] No apply result within timeout', error);
    return { result: 'unknown', detail: `Nothing changed within ${timeoutMs} ms after clicking Apply` };
  }
}
