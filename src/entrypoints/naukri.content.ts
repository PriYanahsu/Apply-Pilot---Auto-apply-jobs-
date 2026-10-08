/**
 * FILE: entrypoints/naukri.content.ts
 * WHAT: Runs inside naukri.com pages. Does NOTHING by itself - it only answers typed commands
 *       from the background and returns { ok, data } or { ok: false, error }.
 * CALLED BY: orchestrator/contentClient.ts (via chrome.tabs.sendMessage)
 * IF IT BREAKS: open the worker tab's DevTools console - every command is logged with a [content] prefix.
 *   NOTE: this script runs on naukri.com's origin, so it can NOT use our IndexedDB or log() helper.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { SNAPSHOT_HTML_MAX_CHARS } from '../config';
import { readSearchPage } from '../naukri/readSearchPage';
import { readJobPage, waitForJobPage } from '../naukri/readJobPage';
import { readProfilePage, waitForProfilePage } from '../naukri/readProfilePage';
import { clickApply, detectApplyResult } from '../naukri/clickApply';
import { answerChatbot, readChatbotWithAllOptions, waitChatbotChange } from '../naukri/chatbot';
import { pageHasCaptcha, type CodedError } from '../naukri/domHelpers';
import type { CommandResult, ContentCommand } from '../shared/messages';

export default defineContentScript({
  matches: ['https://*.naukri.com/*'],
  main() {
    chrome.runtime.onMessage.addListener((command: ContentCommand, _sender, sendResponse) => {
      handleCommand(command).then(sendResponse);
      return true; // keeps the channel open for the async reply
    });
  },
});

async function handleCommand(command: ContentCommand): Promise<CommandResult<unknown>> {
  console.log('[content] command', command.type);
  try {
    if (command.type !== 'PING' && pageHasCaptcha()) {
      return { ok: false, error: { code: 'CAPTCHA', message: 'Naukri is showing a captcha / unusual-activity check' } };
    }
    return { ok: true, data: await runCommand(command) };
  } catch (error) {
    const codedError = error as CodedError;
    // Expected (e.g. a job without an Apply button): the background logs it in the extension's own log.
    console.log('[content] command failed', command.type, codedError.message);
    return {
      ok: false,
      error: {
        code: codedError.code ?? 'UNKNOWN',
        message: codedError.message ?? String(error),
        selectorKey: codedError.selectorKey,
        snapshot: takeSnapshot(),
      },
    };
  }
}

async function runCommand(command: ContentCommand): Promise<unknown> {
  switch (command.type) {
    case 'PING': return { url: location.href };
    case 'SCRAPE_SEARCH_PAGE': return { cards: readSearchPage() };
    case 'SCRAPE_JOB_DETAIL': return waitForJobPage().then(() => readJobPage());
    case 'SCRAPE_PROFILE': return waitForProfilePage().then(() => readProfilePage());
    case 'CLICK_APPLY': return clickApply();
    case 'DETECT_APPLY_RESULT': return detectApplyResult(command.timeoutMs);
    case 'READ_CHATBOT': return readChatbotWithAllOptions();
    case 'ANSWER_CHATBOT': return answerChatbot(command.answer, command.inputType, command.send);
    case 'WAIT_CHATBOT_CHANGE': return waitChatbotChange(command.previousQuestion, command.timeoutMs);
  }
}

/** Evidence for Debug > Snapshots (rule D5): URL, title and the first 50 KB of the page HTML. */
function takeSnapshot() {
  return {
    url: location.href,
    title: document.title,
    html: document.documentElement.outerHTML.slice(0, SNAPSHOT_HTML_MAX_CHARS),
  };
}
