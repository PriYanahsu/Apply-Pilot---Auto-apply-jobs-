/**
 * FILE: linkedin/easyApplyActions.ts
 * WHAT: Does things in the Easy Apply form: open it, fill one question, pick the newest resume,
 *       click Next / Review / Submit, wait for the next page, discard (Test mode), close after "Application sent".
 * CALLED BY: entrypoints/linkedin.content.ts (LI_* commands)
 */
import { cleanText, fillText, humanClick, isVisible, makeError, waitForCondition } from '../naukri/domHelpers';
import type { EasyApplyField, EasyApplyForm } from '../shared/messages';
import { sleep } from '../shared/sleep';
import { findEasyApplyDialog, liButtonByText, liQuery, visibleText } from './dom';
import { FIELD_KEY_ATTR, readEasyApplyForm } from './easyApplyForm';
import { LI_PRIMARY_BUTTONS, LI_TEXT, type LinkedInPrimaryAction } from './selectors';

const DIALOG_OPEN_TIMEOUT_MS = 12_000;
const TYPEAHEAD_WAIT_MS = 3_000;
const SETTLE_MS = 900;

export async function openEasyApply(): Promise<EasyApplyForm> {
  const button = liQuery(document, 'easyApplyButton');
  if (!button) throw makeError('SELECTOR_MISSING', 'Easy Apply button not found', 'easyApplyButton');
  await humanClick(button);
  await waitForCondition(() => findEasyApplyDialog(), DIALOG_OPEN_TIMEOUT_MS, 'Easy Apply form did not open');
  await sleep(SETTLE_MS);
  return readEasyApplyForm();
}

function same(left: string, right: string): boolean {
  return cleanText(left).toLowerCase() === cleanText(right).toLowerCase();
}

function elementsForKey(key: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${FIELD_KEY_ATTR}="${key}"]`));
}

function optionLabel(input: HTMLInputElement): HTMLElement {
  const byFor = input.id ? Array.from(document.querySelectorAll('label')).find((label) => label.htmlFor === input.id) : undefined;
  return byFor ?? input.closest('label') ?? input;
}

async function chooseOptions(inputs: HTMLInputElement[], wanted: string[]): Promise<void> {
  for (const answer of wanted) {
    const input = inputs.find((candidate) => same(visibleText(optionLabel(candidate)) || candidate.value, answer));
    if (!input) throw makeError('SELECTOR_MISSING', `Option "${answer}" not found in the Easy Apply form`, 'fieldBlock');
    if (!input.checked) await humanClick(optionLabel(input));
  }
}

async function chooseSelectOption(select: HTMLSelectElement, answer: string): Promise<void> {
  const options = Array.from(select.options);
  const option = options.find((item) => same(item.text, answer)) ?? options.find((item) => cleanText(item.text).toLowerCase().includes(answer.toLowerCase()));
  if (!option) throw makeError('SELECTOR_MISSING', `Dropdown option "${answer}" not found`, 'fieldBlock');
  select.focus();
  select.value = option.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** City fields suggest places while you type: pick the matching suggestion, else the first one. */
async function chooseTypeahead(input: HTMLElement, answer: string): Promise<void> {
  await fillText(input, answer);
  try {
    const firstMatch = () => {
      const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible);
      return options.find((option) => visibleText(option).toLowerCase().startsWith(answer.toLowerCase())) ?? options[0];
    };
    await humanClick(await waitForCondition(firstMatch, TYPEAHEAD_WAIT_MS, 'No suggestions'));
  } catch (error) {
    console.log('[easy-apply] no typeahead suggestion, keeping the typed text', error);
  }
}

export async function fillEasyApplyField(key: string, kind: EasyApplyField['kind'], answer: string[]): Promise<{ filled: true }> {
  const elements = elementsForKey(key);
  const first = elements[0];
  if (!first) throw makeError('SELECTOR_MISSING', `Form question ${key} disappeared`, 'fieldBlock');
  const value = answer[0] ?? '';
  if (kind === 'radio' || kind === 'resume' || kind === 'checkbox') await chooseOptions(elements as HTMLInputElement[], kind === 'checkbox' ? answer : [value]);
  else if (kind === 'select') await chooseSelectOption(first as HTMLSelectElement, value);
  else if (kind === 'typeahead') await chooseTypeahead(first, value);
  else await fillText(first, value);
  return { filled: true };
}

/** Resume page: the newest upload (LinkedIn lists it first; we also compare the dates under each file). */
export async function selectNewestResume(): Promise<{ chosen: string }> {
  const dialog = findEasyApplyDialog();
  const radios = Array.from(dialog?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []).filter((input) => LI_TEXT.resumeFile.test(visibleText(optionLabel(input)) || visibleText(input.closest('div'))));
  if (radios.length === 0) return { chosen: '' };
  const dated = radios.map((input, index) => {
    const text = visibleText(input.closest('[class]')?.parentElement ?? optionLabel(input));
    const [month, day, year] = (text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)?.slice(1) ?? []).map(Number);
    const time = year ? new Date(year, (month ?? 1) - 1, day ?? 1).getTime() : 0;
    return { input, index, time, text };
  });
  const newest = dated.sort((left, right) => right.time - left.time || left.index - right.index)[0];
  if (newest && !newest.input.checked) await humanClick(optionLabel(newest.input));
  return { chosen: newest?.text.slice(0, 120) ?? '' };
}

/** Clicks Submit / Review / Next (whichever is shown). In Test mode Submit is never clicked. */
export async function clickPrimary(allowSubmit: boolean): Promise<{ action: LinkedInPrimaryAction | 'none'; clicked: boolean }> {
  const dialog = findEasyApplyDialog();
  if (!dialog) throw makeError('SELECTOR_MISSING', 'Easy Apply form is not open', 'dialog');
  for (const button of LI_PRIMARY_BUTTONS) {
    const element = liButtonByText(dialog, button.texts);
    if (!element) continue;
    if (button.action === 'submit' && !allowSubmit) return { action: 'submit', clicked: false };
    await humanClick(element);
    return { action: button.action, clicked: true };
  }
  return { action: 'none', clicked: false };
}

/** Waits until the form moves on (new page / errors / sent / closed), then lets it finish drawing. */
export async function waitForFormChange(previousSignature: string, timeoutMs: number): Promise<EasyApplyForm> {
  try {
    await waitForCondition(() => {
      const form = readEasyApplyForm();
      return !form.open || form.done || form.limitReached || form.errors.length > 0 || form.signature !== previousSignature ? form : null;
    }, timeoutMs, 'Easy Apply form did not change');
  } catch (error) {
    console.log('[easy-apply] form did not change in time', error);
  }
  await sleep(SETTLE_MS);
  return readEasyApplyForm();
}

/** Test mode / problems: close the form and choose "Discard" so nothing is saved or sent. */
export async function discardEasyApply(): Promise<{ discarded: boolean }> {
  const dismiss = liQuery(document, 'dismissButton');
  if (!dismiss) return { discarded: false };
  await humanClick(dismiss);
  try {
    await humanClick(await waitForCondition(() => liButtonByText(document, LI_TEXT.discard), 5_000, 'No Discard button'));
  } catch (error) {
    console.log('[easy-apply] no discard confirmation shown', error);
  }
  return { discarded: true };
}

/** After "Application sent": close the popup (Done / Dismiss). */
export async function closeAfterApplied(): Promise<{ closed: boolean }> {
  const button = liButtonByText(document, LI_TEXT.done) ?? liQuery(document, 'dismissButton');
  if (button) await humanClick(button);
  return { closed: Boolean(button) };
}
