/**
 * FILE: steps/1-checkLogin.ts
 * WHAT: Opens the Naukri homepage in the worker tab. If Naukri redirects to a login page, the user isn't logged in.
 * CALLED BY: orchestrator/runPipeline.ts (step CHECK_LOGIN), steps/2-buildProfile.ts
 * RETURNS: nothing; throws NOT_LOGGED_IN so the run stops and the UI shows a "Log in to Naukri" button.
 */
import { NAUKRI_HOMEPAGE_URL } from '../config';
import { navigateWorkerTab, isLoginUrl } from '../orchestrator/workerTab';
import { makeError } from '../shared/errors';
import { log } from '../shared/log';

export async function checkLogin(): Promise<void> {
  const finalUrl = await navigateWorkerTab(NAUKRI_HOMEPAGE_URL);
  if (isLoginUrl(finalUrl)) {
    throw makeError('NOT_LOGGED_IN', 'Please log in to Naukri in this Chrome window, then try again.');
  }
  await log('1-login', 'Logged in to Naukri');
}
