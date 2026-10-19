/**
 * FILE: entrypoints/company.content.ts
 * WHAT: Runs on Greenhouse, Lever, and Ashby application pages. Does nothing until the background
 *       sends CO_* commands. Same reply shape as the Naukri and LinkedIn content scripts.
 * CALLED BY: orchestrator/workerTab.ts
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { clickCompanyPrimary, fillCompanyField, uploadCompanyResume, waitForCompanyFormChange } from '../company/applyActions';
import { readCompanyForm } from '../company/readApplyForm';
import { SNAPSHOT_HTML_MAX_CHARS } from '../config';
import type { CodedError } from '../naukri/domHelpers';
import type { CommandResult, CompanyCommand } from '../shared/messages';

export default defineContentScript({
  matches: ['https://*.greenhouse.io/*', 'https://*.lever.co/*', 'https://*.ashbyhq.com/*'],
  main() {
    chrome.runtime.onMessage.addListener((command: CompanyCommand | { type: 'PING' }, _sender, sendResponse) => {
      handleCommand(command).then(sendResponse);
      return true;
    });
  },
});

async function handleCommand(command: CompanyCommand | { type: 'PING' }): Promise<CommandResult<unknown>> {
  console.log('[company-content] command', command.type);
  try {
    return { ok: true, data: await runCommand(command) };
  } catch (error) {
    const codedError = error as CodedError;
    console.log('[company-content] command failed', command.type, codedError.message);
    return {
      ok: false,
      error: {
        code: codedError.code ?? 'UNKNOWN', message: codedError.message ?? String(error), selectorKey: codedError.selectorKey,
        snapshot: { url: location.href, title: document.title, html: document.documentElement.outerHTML.slice(0, SNAPSHOT_HTML_MAX_CHARS) },
      },
    };
  }
}

async function runCommand(command: CompanyCommand | { type: 'PING' }): Promise<unknown> {
  switch (command.type) {
    case 'PING': return { url: location.href };
    case 'CO_READ_FORM': return readCompanyForm(document, location.href);
    case 'CO_FILL_FIELD': return fillCompanyField(command.key, command.kind, command.answer);
    case 'CO_UPLOAD_RESUME': return uploadCompanyResume(command.key, command.fileName, command.dataUrl);
    case 'CO_CLICK_PRIMARY': return clickCompanyPrimary(command.allowSubmit);
    case 'CO_WAIT_FORM_CHANGE': return waitForCompanyFormChange(command.previousSignature, command.timeoutMs);
  }
}
