/**
 * FILE: steps/linkedin/li-3-searchJobs.ts
 * WHAT: Finds NEW, FRESH LinkedIn Easy Apply jobs until "Jobs to find" (LinkedIn) is reached.
 *       Same plan as Naukri: your keywords x locations first, then titles suggested from your resume;
 *       page 1, 2, 3... (25 per page) until LinkedIn has no more; searches used up today are remembered.
 *       Slow on purpose (6-12 s between pages) - LinkedIn watches for automation.
 * CALLED BY: orchestrator/runPipeline.ts (step LI_SEARCHING)
 * WRITES: db.jobs (platform 'linkedin', jobId 'li-<id>'), db.searchLog (keys use 'li:<keyword>')
 */
import { LINKEDIN_DELAY_BETWEEN_PAGES_MS, LINKEDIN_MAX_PAGES_PER_SEARCH, MAX_NEW_JOBS_PER_RUN_LIMIT } from '../../config';
import { db, getProfile, getSettings, todayDateString } from '../../db/database';
import type { Job, Settings } from '../../db/types';
import { isJobTooOld, parsePostedText } from '../../matching/postedDate';
import { buildLinkedInSearchUrl } from '../../linkedin/searchUrl';
import { isRunLevelError } from '../../orchestrator/jobFailures';
import { bumpCounter, checkpoint, loadRun, WAIT_REASONS, waitWithCheckpoints } from '../../orchestrator/runState';
import { navigateWorkerTab, sendToContent } from '../../orchestrator/workerTab';
import { errorMessage, makeError } from '../../shared/errors';
import { log } from '../../shared/log';
import { searchPageSchema, type SearchCard } from '../../shared/messages';
import { randomBetween } from '../../shared/sleep';
import { buildSearchCombos, searchLogKey, type SearchCombo } from '../3-searchJobs';

/** LinkedIn searches share the searchLog table with Naukri; the 'li:' prefix keeps them apart. */
function liTask(combo: Pick<SearchCombo, 'keyword' | 'location'>, page: number) {
  return { keyword: `li:${combo.keyword}`, location: combo.location, page };
}

async function markSearched(combo: Pick<SearchCombo, 'keyword' | 'location'>, page: number, newJobs: number, note: string): Promise<void> {
  const date = todayDateString();
  const task = liTask(combo, page);
  await db.searchLog.put({ key: searchLogKey(date, task), date, ...task, newJobs, note, searchedAt: new Date().toISOString() });
}

export async function todaysLinkedInSearchProgress(settings: Settings): Promise<{ done: number; total: number }> {
  const combos = buildSearchCombos(settings);
  const today = todayDateString();
  const doneKeys = new Set((await db.searchLog.where('date').equals(today).toArray()).map((entry) => entry.key));
  return { done: combos.filter((combo) => doneKeys.has(searchLogKey(today, liTask(combo, 0)))).length, total: combos.length };
}

export async function searchLinkedInJobs(runId: number): Promise<void> {
  const settings = await getSettings();
  if (settings.keywords.length === 0) throw makeError('SETUP_MISSING', 'Add at least one search keyword in the Setup tab.');
  const limit = Math.min(Math.max(1, settings.linkedin.maxNewJobsPerRun), MAX_NEW_JOBS_PER_RUN_LIMIT);
  for (const combo of buildSearchCombos(settings, await getProfile())) {
    if (await db.searchLog.get(searchLogKey(todayDateString(), liTask(combo, 0)))) continue;
    if (await searchAllPages(runId, combo, settings, limit)) {
      await log('li-3-search', `Found ${limit} new LinkedIn jobs - search done.`);
      return;
    }
  }
  await log('li-3-search', `Searched everything available today on LinkedIn: ${(await loadRun(runId)).counters.found} new jobs (goal ${limit}).`);
}

async function searchAllPages(runId: number, combo: SearchCombo, settings: Settings, limit: number): Promise<boolean> {
  for (let page = 1; page <= LINKEDIN_MAX_PAGES_PER_SEARCH; page += 1) {
    await checkpoint(runId);
    if (await db.searchLog.get(searchLogKey(todayDateString(), liTask(combo, page)))) continue;
    const roomLeft = limit - (await loadRun(runId)).counters.found;
    if (roomLeft <= 0) return true;
    let cardCount = 0;
    try {
      const url = buildLinkedInSearchUrl({
        keyword: combo.keyword, location: combo.location, page, maxJobAgeDays: settings.maxJobAgeDays,
        experienceYears: settings.experienceYears, easyApplyOnly: settings.linkedin.easyApplyOnly,
      });
      await log('li-3-search', `Searching LinkedIn "${combo.keyword}" ${combo.location || 'anywhere'} page ${page}`, { data: { url } });
      await navigateWorkerTab(url);
      const { cards } = await sendToContent({ type: 'LI_SCRAPE_SEARCH_PAGE' }, searchPageSchema, { step: 'li-3-search' });
      cardCount = cards.length;
      let fresh = 0;
      for (const card of cards) {
        if (fresh >= roomLeft) return true; // page left unmarked: the next run finishes it
        if (await saveCardIfNew(runId, card, combo.keyword, settings.maxJobAgeDays)) fresh += 1;
      }
      await markSearched(combo, page, fresh, 'searched');
      await log('li-3-search', cardCount === 0 ? 'No more results for this search' : `Page had ${cardCount} jobs, ${fresh} new fresh ones`);
    } catch (error) {
      if (isRunLevelError(error)) throw error;
      await log('li-3-search', `Skipping this LinkedIn search page: ${errorMessage(error)}`, { level: 'warn' });
      cardCount = 0;
    }
    if (cardCount === 0) break;
    await waitWithCheckpoints(runId, randomBetween(LINKEDIN_DELAY_BETWEEN_PAGES_MS.min, LINKEDIN_DELAY_BETWEEN_PAGES_MS.max), WAIT_REASONS.betweenSearchPages);
  }
  await markSearched(combo, 0, 0, 'no more results today');
  return false;
}

async function saveCardIfNew(runId: number, card: SearchCard, keyword: string, maxJobAgeDays: number): Promise<boolean> {
  if (await db.jobs.get(card.jobId)) return false;
  const postedAt = parsePostedText(card.postedText);
  const job: Job = {
    ...card, platform: 'linkedin', salaryText: card.salaryText || undefined, keyword,
    postedAt: postedAt ?? '', fetchedAt: new Date().toISOString(), status: 'found',
  };
  if (isJobTooOld(postedAt, maxJobAgeDays)) {
    await db.jobs.put({ ...job, status: 'stale', filterReason: `Posted "${card.postedText || 'unknown'}" - older than ${maxJobAgeDays} days` });
    return false;
  }
  await db.jobs.put(job);
  await bumpCounter(runId, 'found');
  await log('li-3-search', `Found: ${card.title} @ ${card.company} (${card.postedText})`, { jobId: card.jobId });
  return true;
}
