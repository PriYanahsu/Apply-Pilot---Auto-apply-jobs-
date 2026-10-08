/**
 * FILE: linkedin/easyApplyForm.ts
 * WHAT: Reads the CURRENT page of the LinkedIn Easy Apply form: every question (label, type, options,
 *       current value, required, error), progress ("2/7 pages"), which footer button is shown
 *       (Next / Review / Submit application), and whether LinkedIn says "Application sent" or "limit reached".
 *       Each question's input gets a data-naa-key attribute so easyApplyActions.ts can fill it later.
 * CALLED BY: entrypoints/linkedin.content.ts (LI_READ_FORM, LI_WAIT_FORM_CHANGE)
 */
import { cleanText, isVisible } from '../naukri/domHelpers';
import type { EasyApplyField, EasyApplyForm } from '../shared/messages';
import { findEasyApplyDialog, liButtonByText, visibleText } from './dom';
import { LI_PRIMARY_BUTTONS, LI_SEL, LI_TEXT } from './selectors';

export const FIELD_KEY_ATTR = 'data-naa-key';
const BLOCK_SELECTOR = LI_SEL.fieldBlock.join(', ');
const PLACEHOLDER_OPTION = /^(select an option|select|choose|--)$/i;
const SKIPPED_INPUT_TYPES = ['hidden', 'file', 'submit', 'button', 'image', 'reset'];

function labelForControl(control: HTMLElement, dialog: HTMLElement): string {
  const byFor = control.id ? Array.from(dialog.querySelectorAll('label')).find((label) => label.htmlFor === control.id) : undefined;
  if (byFor && visibleText(byFor)) return visibleText(byFor);
  const ariaLabel = control.getAttribute('aria-label');
  if (ariaLabel) return cleanText(ariaLabel);
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) return labelledBy.split(' ').map((id) => visibleText(document.getElementById(id))).join(' ').trim();
  return cleanText(control.closest('label')?.textContent) || (control as HTMLInputElement).placeholder || '';
}

/** The question text for a group of options: fieldset legend, else the block's first label/heading. */
function questionForGroup(control: HTMLElement, dialog: HTMLElement): string {
  const legend = control.closest('fieldset')?.querySelector('legend');
  if (legend && visibleText(legend)) return visibleText(legend);
  const block = control.closest(BLOCK_SELECTOR);
  const candidates = Array.from(block?.querySelectorAll<HTMLElement>('legend, label, span, p') ?? []);
  // The first text element that is not itself an option (options contain the input or point to it).
  const heading = candidates.find((element) => !element.querySelector('input') && !(element instanceof HTMLLabelElement && element.htmlFor) && visibleText(element));
  return visibleText(heading) || labelForControl(control, dialog);
}

function errorFor(control: HTMLElement): string {
  const block = control.closest(BLOCK_SELECTOR);
  const errorElement = block ? LI_SEL.fieldError.map((selector) => block.querySelector(selector)).find((element) => element && visibleText(element)) : null;
  if (errorElement) return visibleText(errorElement);
  return control.getAttribute('aria-invalid') === 'true' ? 'invalid' : '';
}

function isRequired(label: string, control: HTMLElement): boolean {
  return /\*\s*$/.test(label) || (control as HTMLInputElement).required || control.getAttribute('aria-required') === 'true';
}

function readGroup(group: HTMLInputElement[], key: string, dialog: HTMLElement): EasyApplyField {
  group.forEach((input) => input.setAttribute(FIELD_KEY_ATTR, key));
  const options = group.map((input) => labelForControl(input, dialog));
  const question = questionForGroup(group[0] as HTMLInputElement, dialog);
  const isRadio = (group[0] as HTMLInputElement).type === 'radio';
  const kind = options.some((option) => LI_TEXT.resumeFile.test(option)) ? 'resume' : isRadio ? 'radio' : 'checkbox';
  return {
    key, label: question.replace(/\*\s*$/, '').trim(), kind, options,
    value: group.filter((input) => input.checked).map((input) => labelForControl(input, dialog)),
    required: isRequired(question, group[0] as HTMLInputElement), error: errorFor(group[0] as HTMLInputElement),
  };
}

function readSingle(control: HTMLElement, key: string, dialog: HTMLElement): EasyApplyField {
  control.setAttribute(FIELD_KEY_ATTR, key);
  const label = labelForControl(control, dialog);
  const base = { key, label: label.replace(/\*\s*$/, '').trim(), required: isRequired(label, control), error: errorFor(control) };
  if (control instanceof HTMLSelectElement) {
    const options = Array.from(control.options).map((option) => cleanText(option.text)).filter((text) => text && !PLACEHOLDER_OPTION.test(text));
    const selected = cleanText(control.selectedOptions[0]?.text);
    return { ...base, kind: 'select', options, value: selected && !PLACEHOLDER_OPTION.test(selected) ? [selected] : [] };
  }
  const input = control as HTMLInputElement;
  const isTypeahead = control.getAttribute('role') === 'combobox' || control.hasAttribute('aria-autocomplete');
  const kind = control instanceof HTMLTextAreaElement ? 'textarea' : isTypeahead ? 'typeahead' : input.type === 'number' ? 'number' : 'text';
  return { ...base, kind, options: [], value: input.value?.trim() ? [input.value.trim()] : [] };
}

function readFields(dialog: HTMLElement): EasyApplyField[] {
  const fields: EasyApplyField[] = [];
  const groupsDone = new Set<Element>();
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('input, select, textarea'));
  for (const control of controls) {
    const input = control as HTMLInputElement;
    if (control instanceof HTMLInputElement && SKIPPED_INPUT_TYPES.includes(input.type)) continue;
    if (input.type === 'radio' || input.type === 'checkbox') {
      // Group radios by name; checkboxes by their fieldset / question block.
      const groupRoot = input.type === 'radio' ? null : input.closest('fieldset') ?? input.closest(BLOCK_SELECTOR);
      const group = input.type === 'radio'
        ? controls.filter((other) => (other as HTMLInputElement).type === 'radio' && (other as HTMLInputElement).name === input.name) as HTMLInputElement[]
        : controls.filter((other) => (other as HTMLInputElement).type === 'checkbox' && (other.closest('fieldset') ?? other.closest(BLOCK_SELECTOR)) === groupRoot) as HTMLInputElement[];
      const marker = group[0] as Element;
      if (groupsDone.has(marker)) continue;
      groupsDone.add(marker);
      fields.push(readGroup(group, `f${fields.length}`, dialog));
    } else if (isVisible(control)) {
      fields.push(readSingle(control, `f${fields.length}`, dialog));
    }
  }
  return fields;
}

export function readEasyApplyForm(): EasyApplyForm {
  const dialog = findEasyApplyDialog();
  const pageText = visibleText(document.body);
  const closed = { open: false, done: LI_TEXT.applicationSent.test(pageText), limitReached: LI_TEXT.dailyLimit.test(pageText), progress: '', fields: [], primaryButton: null, errors: [], signature: 'closed' };
  if (!dialog) return closed;
  const text = visibleText(dialog);
  const fields = readFields(dialog);
  const primary = LI_PRIMARY_BUTTONS.find((button) => liButtonByText(dialog, button.texts)) ?? null;
  const progress = text.match(LI_TEXT.progress)?.[0] ?? '';
  return {
    open: true,
    done: LI_TEXT.applicationSent.test(text),
    limitReached: LI_TEXT.dailyLimit.test(text),
    progress,
    fields,
    primaryButton: primary?.action ?? null,
    errors: fields.map((field) => field.error).filter(Boolean),
    signature: `${progress}|${fields.map((field) => field.label).join('|')}|${primary?.action ?? ''}`,
  };
}
