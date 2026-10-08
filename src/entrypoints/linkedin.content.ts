/**
 * FILE: entrypoints/linkedin.content.ts
 * WHAT: Runs inside linkedin.com pages. Does NOTHING by itself - it only answers LI_* commands from the background
 *       and returns { ok, data } or { ok: false, error } (same contract as the Naukri content script).
 * CALLED BY: orchestrator/workerTab.ts (chrome.tabs.sendMessage)
 * IF IT BREAKS: open the worker tab's DevTools console - every command is logged with a [li-content] prefix.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
const LINKEDIN_SNAPSHOT_MAX_CHARS = 400_000;
import { liQueryAll, visibleText } from '../linkedin/dom';
import {
  clickPrimary, closeAfterApplied, discardEasyApply, fillEasyApplyField, openEasyApply, selectNewestResume, waitForFormChange,
} from '../linkedin/easyApplyActions';
import { readEasyApplyForm } from '../linkedin/easyApplyForm';
import { readLinkedInJobPage, waitForLinkedInJobPage } from '../linkedin/readJobPage';
import { readLinkedInSearchPage } from '../linkedin/readSearchPage';
import { LI_TEXT } from '../linkedin/selectors';
import type { CodedError } from '../naukri/domHelpers';
import { waitForCondition } from '../naukri/domHelpers';
import type { CommandResult, LinkedInCommand } from '../shared/messages';

const SEARCH_PAGE_WAIT_MS = 15_000;
const CARD_RENDER_PAUSE_MS = 250;

export default defineContentScript({
  matches: ['https://www.linkedin.com/*'],
  main() {
    chrome.runtime.onMessage.addListener((command: LinkedInCommand | { type: 'PING' }, _sender, sendResponse) => {
      handleCommand(command).then(sendResponse);
      return true; // keeps the channel open for the async reply
    });
  },
});

/** The page's CONTENT for Debug > Snapshots: LinkedIn's <head> and inline styles alone exceed 50 KB. */
function contentSnapshot(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('script, style, link, svg, noscript, img, iframe').forEach((node) => node.remove());
  copy.querySelectorAll('[style]').forEach((node) => node.removeAttribute('style'));
  return copy.outerHTML.slice(0, LINKEDIN_SNAPSHOT_MAX_CHARS);
}

function securityCheckShown(): boolean {
  return location.pathname.includes('/checkpoint/') || LI_TEXT.securityCheck.test(visibleText(document.body).slice(0, 5_000));
}

async function handleCommand(command: LinkedInCommand | { type: 'PING' }): Promise<CommandResult<unknown>> {
  console.log('[li-content] command', command.type);
  try {
    if (command.type !== 'PING' && command.type !== 'LI_PING' && securityCheckShown()) {
      return { ok: false, error: { code: 'CAPTCHA', message: 'LinkedIn is showing a security check' } };
    }
    return { ok: true, data: await runCommand(command) };
  } catch (error) {
    const codedError = error as CodedError;
    console.log('[li-content] command failed', command.type, codedError.message);
    return {
      ok: false,
      error: {
        code: codedError.code ?? 'UNKNOWN', message: codedError.message ?? String(error), selectorKey: codedError.selectorKey,
        snapshot: { url: location.href, title: document.title, html: contentSnapshot() },
      },
    };
  }
}

/** Search results render after the page "loads": wait for cards (or a no-results message). */
async function readSearchPageWhenReady() {
  try {
    await waitForCondition(() => {
      try {
        return liQueryAll(document, 'searchCard').length > 0 || readLinkedInSearchPage().length > 0;
      } catch (error) {
        console.log('[li-content] search page not ready', String(error));
        return false;
      }
    }, SEARCH_PAGE_WAIT_MS, 'LinkedIn search results did not load');
  } catch (error) {
    console.log('[li-content] reading search page anyway', error);
  }
  // LinkedIn only fills a card when it is on screen ("occludable"): bring each one into view, like scrolling the list.
  for (const card of liQueryAll(document, 'searchCard')) {
    card.scrollIntoView({ block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, CARD_RENDER_PAUSE_MS));
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { cards: readLinkedInSearchPage() };
}

const PROFILE_SCROLL_STEPS = 8;

/** Your own profile: wait for the name, scroll down so Experience / Skills / Education load, then read the text. */
async function readOwnProfilePage() {
  try {
    await waitForCondition(() => document.querySelector('main h1, h1'), SEARCH_PAGE_WAIT_MS, 'Profile did not load');
  } catch (error) {
    console.log('[li-content] profile heading not found, reading anyway', error);
  }
  for (let step = 1; step <= PROFILE_SCROLL_STEPS; step += 1) {
    window.scrollTo(0, (document.body.scrollHeight * step) / PROFILE_SCROLL_STEPS);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  const main = (document.querySelector('main') ?? document.body).cloneNode(true) as HTMLElement;
  main.querySelectorAll('nav, aside, footer, script, style, svg, [role="complementary"]').forEach((node) => node.remove());
  const name = visibleText(document.querySelector('main h1, h1'));
  const headline = visibleText(document.querySelector('main h1')?.closest('section')?.querySelector('.text-body-medium, [data-generated-suggestion-target]') ?? null);
  return { name, headline, fullText: visibleText(main).slice(0, 20_000) };
}

async function runCommand(command: LinkedInCommand | { type: 'PING' }): Promise<unknown> {
  switch (command.type) {
    case 'PING':
    case 'LI_PING': return { url: location.href };
    case 'LI_SCRAPE_SEARCH_PAGE': return readSearchPageWhenReady();
    case 'LI_SCRAPE_JOB': return waitForLinkedInJobPage().then(() => readLinkedInJobPage());
    case 'LI_SCRAPE_PROFILE': return readOwnProfilePage();
    case 'LI_OPEN_EASY_APPLY': return openEasyApply();
    case 'LI_READ_FORM': return readEasyApplyForm();
    case 'LI_FILL_FIELD': return fillEasyApplyField(command.key, command.kind, command.answer);
    case 'LI_SELECT_NEWEST_RESUME': return selectNewestResume();
    case 'LI_CLICK_PRIMARY': return clickPrimary(command.allowSubmit);
    case 'LI_WAIT_FORM_CHANGE': return waitForFormChange(command.previousSignature, command.timeoutMs);
    case 'LI_DISCARD': return discardEasyApply();
    case 'LI_CLOSE_DONE': return closeAfterApplied();
  }
}
