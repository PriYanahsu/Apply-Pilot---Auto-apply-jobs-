/**
 * FILE: company/applyActions.ts
 * WHAT: Fills one question on a Greenhouse / Lever / Ashby form and clicks the button under it
 *       (Next / Review / Submit). Test mode never clicks Submit.
 * CALLED BY: entrypoints/company.content.ts
 */
import { cleanText, fillText, humanClick, isVisible, makeError, waitForCondition } from '../naukri/domHelpers';
import type { CompanyForm, EasyApplyField } from '../shared/messages';
import { sleep } from '../shared/sleep';
import { FIELD_KEY_ATTR, readCompanyForm } from './readApplyForm';

const TYPEAHEAD_WAIT_MS = 3_000;
const SETTLE_MS = 700;

function same(left: string, right: string): boolean {
  return cleanText(left).toLowerCase() === cleanText(right).toLowerCase();
}

function elementsForKey(key: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${FIELD_KEY_ATTR}="${CSS.escape(key)}"]`));
}

function optionLabel(input: HTMLInputElement): HTMLElement {
  const byFor = input.id ? Array.from(document.querySelectorAll('label')).find((label) => label.htmlFor === input.id) : undefined;
  return byFor ?? input.closest('label') ?? input;
}

async function chooseOptions(inputs: HTMLInputElement[], wanted: string[]): Promise<void> {
  for (const answer of wanted) {
    const input = inputs.find((candidate) => same(cleanText(optionLabel(candidate).textContent) || candidate.value, answer));
    if (!input) throw makeError('SELECTOR_MISSING', `Option "${answer}" not found on the company form`, 'field');
    if (!input.checked) await humanClick(optionLabel(input));
  }
}

async function chooseSelectOption(select: HTMLSelectElement, answer: string): Promise<void> {
  const options = Array.from(select.options);
  const option = options.find((item) => same(item.text, answer)) ?? options.find((item) => cleanText(item.text).toLowerCase().includes(answer.toLowerCase()));
  if (!option) throw makeError('SELECTOR_MISSING', `Dropdown option "${answer}" not found`, 'field');
  select.focus();
  select.value = option.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

async function chooseTypeahead(input: HTMLElement, answer: string): Promise<void> {
  await fillText(input, answer);
  try {
    const firstMatch = () => {
      const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible);
      return options.find((option) => cleanText(option.textContent).toLowerCase().startsWith(answer.toLowerCase())) ?? options[0];
    };
    await humanClick(await waitForCondition(firstMatch, TYPEAHEAD_WAIT_MS, 'No suggestions'));
  } catch (error) {
    console.log('[company] no typeahead suggestion, keeping the typed text', error);
  }
}

export async function fillCompanyField(key: string, kind: EasyApplyField['kind'], answer: string[]): Promise<{ filled: true }> {
  const elements = elementsForKey(key);
  const first = elements[0];
  if (!first) throw makeError('SELECTOR_MISSING', `Form question ${key} disappeared`, 'field');
  if (kind === 'resume') throw makeError('UNKNOWN', 'This form wants a resume file. ApplyPilot cannot upload a file on this site.');
  const value = answer[0] ?? '';
  if (kind === 'radio' || kind === 'checkbox') await chooseOptions(elements as HTMLInputElement[], kind === 'checkbox' ? answer : [value]);
  else if (kind === 'select') await chooseSelectOption(first as HTMLSelectElement, value);
  else if (kind === 'typeahead') await chooseTypeahead(first, value);
  else await fillText(first, value);
  return { filled: true };
}

/** Puts the saved resume PDF into a file input (Greenhouse, Lever, Ashby all read the input's change event). */
export async function uploadCompanyResume(key: string, fileName: string, dataUrl: string): Promise<{ filled: true }> {
  const input = elementsForKey(key)[0];
  if (!(input instanceof HTMLInputElement) || input.type !== 'file') throw makeError('SELECTOR_MISSING', `Resume upload ${key} disappeared`, 'field');
  const [meta = '', base64 = ''] = dataUrl.split(',');
  const type = /^data:([^;,]+)/.exec(meta)?.[1] ?? 'application/pdf';
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], fileName, { type }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  // Lever and Greenhouse parse the resume and prefill name / email a moment later.
  await sleep(SETTLE_MS * 3);
  return { filled: true };
}

function buttonLabel(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) return cleanText(element.value).toLowerCase();
  return cleanText(element.textContent || element.getAttribute('aria-label')).toLowerCase();
}

const PRIMARY_BUTTONS = [
  { action: 'submit' as const, texts: ['submit application', 'submit', 'send application'] },
  { action: 'review' as const, texts: ['review your application', 'review'] },
  { action: 'next' as const, texts: ['next', 'continue', 'save and continue'] },
];

/** Clicks Submit / Review / Next. In Test mode Submit is never clicked. */
export async function clickCompanyPrimary(allowSubmit: boolean): Promise<{ action: 'submit' | 'review' | 'next' | 'none'; clicked: boolean }> {
  const form = document.querySelector('form') ?? document.body;
  const scopes = [form, form.parentElement].filter((element): element is HTMLElement => Boolean(element));
  for (const scope of scopes) {
    const buttons = Array.from(scope.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]')).filter(isVisible);
    for (const wanted of PRIMARY_BUTTONS) {
      const element = buttons.find((button) => wanted.texts.some((text) => buttonLabel(button) === text || buttonLabel(button).startsWith(`${text} `)));
      if (!element) continue;
      if (wanted.action === 'submit' && !allowSubmit) return { action: 'submit', clicked: false };
      await humanClick(element);
      return { action: wanted.action, clicked: true };
    }
  }
  return { action: 'none', clicked: false };
}

export async function waitForCompanyFormChange(previousSignature: string, timeoutMs: number): Promise<CompanyForm> {
  try {
    await waitForCondition(() => {
      const form = readCompanyForm(document, location.href);
      return form.done || form.blocked !== '' || form.signature !== previousSignature ? form : null;
    }, timeoutMs, 'Company form did not change');
  } catch (error) {
    console.log('[company] form did not change in time', error);
  }
  await sleep(SETTLE_MS);
  return readCompanyForm(document, location.href);
}
