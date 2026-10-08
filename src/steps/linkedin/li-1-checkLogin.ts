/**
 * FILE: steps/linkedin/li-1-checkLogin.ts
 * WHAT: Opens the LinkedIn feed in the worker tab. A redirect to /login (or /authwall) = not logged in;
 *       /checkpoint/ = LinkedIn security check (the run pauses so you can solve it).
 * CALLED BY: orchestrator/runPipeline.ts (step LI_CHECK_LOGIN)
 */
import { LINKEDIN_FEED_URL, LINKEDIN_LOGIN_URL_MARKERS, LINKEDIN_SECURITY_URL_MARKERS } from '../../config';
import { navigateWorkerTab } from '../../orchestrator/workerTab';
import { makeError } from '../../shared/errors';
import { log } from '../../shared/log';

export async function checkLinkedInLogin(): Promise<void> {
  const finalUrl = await navigateWorkerTab(LINKEDIN_FEED_URL);
  if (LINKEDIN_SECURITY_URL_MARKERS.some((marker) => finalUrl.includes(marker))) {
    throw makeError('CAPTCHA', 'LinkedIn is asking for a security check. Solve it in the LinkedIn tab, then press Resume.');
  }
  if (LINKEDIN_LOGIN_URL_MARKERS.some((marker) => finalUrl.includes(marker))) {
    throw makeError('NOT_LOGGED_IN', 'Please log in to LinkedIn in this Chrome window, then try again.');
  }
  await log('li-1-login', 'Logged in to LinkedIn');
}
