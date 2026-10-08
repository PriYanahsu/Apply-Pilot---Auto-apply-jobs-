/**
 * FILE: steps/3-searchJobs.ts
 * WHAT: Finds NEW, FRESH jobs (freshness gate #1) until it has "Jobs to find per run" of them (max 200):
 *   - for each keyword x location it keeps opening the next results page until Naukri has no more results;
 *   - if your keywords run out, it also searches the job titles suggested from your resume;
 *   - every search used up today is remembered (db.searchLog): later runs today skip it, tomorrow starts fresh;
 *   - a search with no results, or one that fails to load, is skipped - it never stops the run.
 * CALLED BY: orchestrator/runPipeline.ts (step SEARCHING)
 * READS: settings.keywords / locations / maxJobAgeDays / maxNewJobsPerRun, db.profile (suggested titles)
 * WRITES: db.jobs, db.searchLog
 * IF IT BREAKS: 0 jobs found -> Debug > Snapshots (searchCard) and naukri/selectors.ts SEARCH_URL.
 */
import { DELAY_BETWEEN_PAGES_MS, MAX_NEW_JOBS_PER_RUN_LIMIT, MAX_PAGES_PER_SEARCH } from '../config';
import { db, getProfile, getSettings, todayDateString } from '../db/database';
import type { CandidateProfile, Job, Settings } from '../db/types';
import { parseExperienceRange } from '../matching/experienceRange';
import { isJobTooOld, parsePostedText } from '../matching/postedDate';
import { buildSearchUrl } from '../naukri/searchUrl';
import { isRunLevelError } from '../orchestrator/jobFailures';
import { bumpCounter, checkpoint, loadRun, WAIT_REASONS, waitWithCheckpoints } from '../orchestrator/runState';
import { navigateWorkerTab, sendToContent } from '../orchestrator/workerTab';
import { errorMessage, makeError } from '../shared/errors';
import { log } from '../shared/log';
import { searchPageSchema, type SearchCard } from '../shared/messages';
import { randomBetween } from '../shared/sleep';

/** One search = one keyword in one location (all its pages). `suggested` = from your resume, used only if needed. */
export interface SearchCombo {
  keyword: string;
  location: string;
  suggested: boolean;
}

export interface SearchTask {
  keyword: string;
  location: string;
  page: number;
}

/** Your keywords first, then resume-suggested titles you didn't already list (case-insensitive). */
export function buildSearchCombos(settings: Settings, profile?: Pick<CandidateProfile, 'searchKeywords' | 'targetTitles'>): SearchCombo[] {
  const locations = settings.locations.length > 0 ? settings.locations : [''];
  const seen = new Set(settings.keywords.map((keyword) => keyword.trim().toLowerCase()));
  const suggestions: string[] = [];
  for (const title of [...(profile?.searchKeywords ?? []), ...(profile?.targetTitles ?? [])]) {
    const key = title.trim().toLowerCase();
    if (key && !seen.has(key)) { seen.add(key); suggestions.push(title.trim()); }
  }
  const combos: SearchCombo[] = [];
  for (const keyword of settings.keywords) for (const location of locations) combos.push({ keyword, location, suggested: false });
  for (const keyword of suggestions) for (const location of locations) combos.push({ keyword, location, suggested: true });
  return combos;
}

export function searchLogKey(date: string, task: SearchTask): string {
  return `${date}|${task.keyword.toLowerCase()}|${task.location.toLowerCase()}|${task.page}`;
}

/** Page 0 is the marker for "this keyword + location has no more results today". */
function exhaustedKey(date: string, combo: SearchCombo): string {
  return searchLogKey(date, { keyword: combo.keyword, location: combo.location, page: 0 });
}

async function markSearched(task: SearchTask, newJobs: number, note: string): Promise<void> {
  const date = todayDateString();
  await db.searchLog.put({ key: searchLogKey(date, task), date, ...task, newJobs, note, searchedAt: new Date().toISOString() });
}

/** Today's search progress for the Run tab: how many of YOUR keyword x location searches are used up. */
export async function todaysSearchProgress(settings: Settings): Promise<{ done: number; total: number }> {
  const combos = buildSearchCombos(settings);
  const today = todayDateString();
  const doneKeys = new Set((await db.searchLog.where('date').equals(today).toArray()).map((entry) => entry.key));
  return { done: combos.filter((combo) => doneKeys.has(exhaustedKey(today, combo))).length, total: combos.length };
}

export async function searchJobs(runId: number): Promise<void> {
  const settings = await getSettings();
  if (settings.keywords.length === 0) throw makeError('SETUP_MISSING', 'Add at least one search keyword in the Setup tab.');
  const limit = Math.min(Math.max(1, settings.maxNewJobsPerRun), MAX_NEW_JOBS_PER_RUN_LIMIT);
  const combos = buildSearchCombos(settings, await getProfile());
  let announcedSuggestions = false;

  for (const combo of combos) {
    if (await db.searchLog.get(exhaustedKey(todayDateString(), combo))) continue; // used up earlier today
    if (combo.suggested && !announcedSuggestions) {
      announcedSuggestions = true;
      await log('3-search', 'Your keywords have no more new jobs today - also searching job titles suggested from your resume');
    }
    const reachedLimit = await searchAllPages(runId, combo, settings, limit);
    if (reachedLimit) {
      await log('3-search', `Found ${limit} new jobs - search done. The next run today continues where this one stopped.`);
      return;
    }
  }
  const found = (await loadRun(runId)).counters.found;
  await log('3-search', `Searched everything available today: ${found} new jobs (goal ${limit}). Naukri has no more fresh results for these keywords - add keywords / cities, or allow older jobs, to find more.`);
}

/** Opens page 1, 2, 3... of one search until the goal is reached or Naukri has no more results. Returns true at the goal. */
async function searchAllPages(runId: number, combo: SearchCombo, settings: Settings, limit: number): Promise<boolean> {
  for (let page = 1; page <= MAX_PAGES_PER_SEARCH; page += 1) {
    await checkpoint(runId);
    const task = { keyword: combo.keyword, location: combo.location, page };
    if (await db.searchLog.get(searchLogKey(todayDateString(), task))) continue; // this page was read earlier today
    const roomLeft = limit - (await loadRun(runId)).counters.found;
    if (roomLeft <= 0) return true;

    const result = await searchOnePageSafely(runId, task, settings, roomLeft);
    if (result === 'goal_reached') return true;
    if (result === 'no_more_results') break;
    await waitWithCheckpoints(runId, randomBetween(DELAY_BETWEEN_PAGES_MS.min, DELAY_BETWEEN_PAGES_MS.max), WAIT_REASONS.betweenSearchPages);
  }
  await markSearched({ keyword: combo.keyword, location: combo.location, page: 0 }, 0, 'no more results today');
  return false;
}

type PageResult = 'goal_reached' | 'no_more_results' | 'continue';

/** One results page. Problems with this page are logged and skipped; only run-level errors stop the run. */
async function searchOnePageSafely(runId: number, task: SearchTask, settings: Settings, roomLeft: number): Promise<PageResult> {
  try {
    const { cardCount, freshCount, stoppedEarly } = await searchOnePage(runId, task, settings, roomLeft);
    // Stopped mid-page at the goal: leave this page unmarked so the next run finishes it (duplicates are skipped).
    if (stoppedEarly) return 'goal_reached';
    await markSearched(task, freshCount, 'searched');
    // Naukri shows an empty page after the last page of results.
    return cardCount === 0 ? 'no_more_results' : 'continue';
  } catch (error) {
    if (isRunLevelError(error)) throw error;
    await log('3-search', `Skipping "${task.keyword}" ${task.location || 'anywhere'} page ${task.page}: ${errorMessage(error)} - moving to the next search`, { level: 'warn' });
    await markSearched(task, 0, `skipped: ${errorMessage(error)}`);
    return 'no_more_results';
  }
}

async function searchOnePage(runId: number, task: SearchTask, settings: Settings, roomLeft: number) {
  const url = buildSearchUrl({ ...task, experienceYears: settings.experienceYears, maxJobAgeDays: settings.maxJobAgeDays });
  await log('3-search', `Searching "${task.keyword}" ${task.location || 'anywhere'} page ${task.page}`, { data: { url } });
  await navigateWorkerTab(url);
  const { cards } = await sendToContent({ type: 'SCRAPE_SEARCH_PAGE' }, searchPageSchema, { step: '3-search' });

  let freshCount = 0;
  for (const card of cards) {
    if (freshCount >= roomLeft) {
      await log('3-search', `Page had ${cards.length} cards; reached the goal after ${freshCount}`);
      return { cardCount: cards.length, freshCount, stoppedEarly: true };
    }
    if (await saveCardIfNew(runId, card, task.keyword, settings.maxJobAgeDays)) freshCount += 1;
  }
  await log('3-search', cards.length === 0 ? 'No more results for this search' : `Page had ${cards.length} cards, ${freshCount} new fresh jobs`);
  return { cardCount: cards.length, freshCount, stoppedEarly: false };
}

/** Returns true when the card was a NEW, FRESH job and was saved as 'found'. */
async function saveCardIfNew(runId: number, card: SearchCard, keyword: string, maxJobAgeDays: number): Promise<boolean> {
  if (await db.jobs.get(card.jobId)) return false; // de-duplicate across keywords, locations and runs
  const postedAt = parsePostedText(card.postedText);
  const range = parseExperienceRange(card.experienceText);
  const job: Job = {
    ...card, salaryText: card.salaryText || undefined, keyword,
    postedAt: postedAt ?? '', fetchedAt: new Date().toISOString(),
    expMin: range?.min, expMax: range?.max, status: 'found',
  };
  if (isJobTooOld(postedAt, maxJobAgeDays)) {
    // Freshness gate #1 (rule R2). Saved as 'stale' so we don't look at it again.
    await db.jobs.put({ ...job, status: 'stale', filterReason: `Posted "${card.postedText || 'unknown'}" - older than ${maxJobAgeDays} days` });
    return false;
  }
  await db.jobs.put(job);
  await bumpCounter(runId, 'found');
  await log('3-search', `Found: ${card.title} @ ${card.company} (${card.postedText})`, { jobId: card.jobId });
  return true;
}
