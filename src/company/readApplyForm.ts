/**
 * FILE: company/readApplyForm.ts
 * WHAT: Reads the application form currently on a Greenhouse, Lever, or Ashby page:
 *       each visible question (label, type, options, value, required, error), the button under the form
 *       (Next / Review / Submit), and whether the page is a success screen, a login wall, or a captcha.
 *       Each input gets data-ap-key so applyActions.ts can fill that exact control.
 * CALLED BY: entrypoints/company.content.ts
 */
import { cleanText, isVisible } from '../naukri/domHelpers';
import type { CompanyForm, EasyApplyField } from '../shared/messages';

export const FIELD_KEY_ATTR = 'data-ap-key';

const SUCCESS_TEXT = /thank you for applying|thanks for applying|application (has been |was )?(successfully )?(submitted|received)|successfully submitted|we (have )?received your application/i;
const SUCCESS_PATH = /\/(thanks|thank-you|confirmation|submitted|application_confirmation)(\/|$)/i;
const PLACEHOLDER_OPTION = /^(select an option|select|choose|--|please select)$/i;
const SKIPPED_INPUT_TYPES = ['hidden', 'submit', 'button', 'image', 'reset'];
const PRIMARY_BUTTONS = [
  { action: 'submit' as const, texts: ['submit application', 'submit', 'send application'] },
  { action: 'review' as const, texts: ['review your application', 'review'] },
  { action: 'next' as const, texts: ['next', 'continue', 'save and continue'] },
];

function labelFor(control: HTMLElement, root: ParentNode): string {
  const doc = control.ownerDocument;
  const byFor = control.id ? Array.from(root.querySelectorAll('label')).find((label) => label.htmlFor === control.id) : undefined;
  if (byFor && cleanText(byFor.textContent)) return cleanText(byFor.textContent);
  const aria = control.getAttribute('aria-label');
  if (aria) return cleanText(aria);
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(' ').map((id) => cleanText(doc.getElementById(id)?.textContent)).join(' ').trim();
    if (text) return text;
  }
  const wrapping = control.closest('label');
  if (wrapping && cleanText(wrapping.textContent)) return cleanText(wrapping.textContent);
  return cleanText((control as HTMLInputElement).placeholder) || cleanText(control.getAttribute('name'));
}

function questionForGroup(control: HTMLElement, root: ParentNode): string {
  const legend = control.closest('fieldset')?.querySelector('legend');
  if (legend && cleanText(legend.textContent)) return cleanText(legend.textContent);
  return labelFor(control, root);
}

function isRequired(label: string, control: HTMLElement): boolean {
  return /\*\s*$/.test(label) || (control as HTMLInputElement).required || control.getAttribute('aria-required') === 'true';
}

function errorFor(control: HTMLElement): string {
  const block = control.closest('fieldset, .field, .application-field, [class*="field"]') ?? control.parentElement;
  const alert = block?.querySelector('[role="alert"]');
  if (alert && cleanText(alert.textContent)) return cleanText(alert.textContent);
  return control.getAttribute('aria-invalid') === 'true' ? 'invalid' : '';
}

function readGroup(group: HTMLInputElement[], key: string, root: ParentNode): EasyApplyField {
  group.forEach((input) => input.setAttribute(FIELD_KEY_ATTR, key));
  const options = group.map((input) => labelFor(input, root)).filter(Boolean);
  const question = questionForGroup(group[0] as HTMLInputElement, root);
  const kind = (group[0] as HTMLInputElement).type === 'radio' ? 'radio' : 'checkbox';
  return {
    key, label: question.replace(/\*\s*$/, '').trim(), kind, options,
    value: group.filter((input) => input.checked).map((input) => labelFor(input, root)),
    required: isRequired(question, group[0] as HTMLInputElement), error: errorFor(group[0] as HTMLInputElement),
  };
}

function readSingle(control: HTMLElement, key: string, root: ParentNode): EasyApplyField {
  control.setAttribute(FIELD_KEY_ATTR, key);
  const label = labelFor(control, root);
  const base = { key, label: label.replace(/\*\s*$/, '').trim(), required: isRequired(label, control), error: errorFor(control) };
  if (control instanceof HTMLInputElement && control.type === 'file') {
    return { ...base, kind: 'resume', options: [], value: Array.from(control.files ?? []).map((file) => file.name) };
  }
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

function readFields(root: HTMLElement): EasyApplyField[] {
  const fields: EasyApplyField[] = [];
  const groupsDone = new Set<Element>();
  // Keys are positions on THIS read. A key left on a control from an earlier read would send an answer to the wrong question.
  root.ownerDocument.querySelectorAll(`[${FIELD_KEY_ATTR}]`).forEach((element) => element.removeAttribute(FIELD_KEY_ATTR));
  const controls = Array.from(root.querySelectorAll<HTMLElement>('input, select, textarea'));
  for (const control of controls) {
    const input = control as HTMLInputElement;
    if (control instanceof HTMLInputElement && SKIPPED_INPUT_TYPES.includes(input.type)) continue;
    if (!isVisible(control) && input.type !== 'file') continue;
    if (input.type === 'radio' || input.type === 'checkbox') {
      const group = controls.filter((other) => (other as HTMLInputElement).type === input.type && (other as HTMLInputElement).name === input.name && input.name) as HTMLInputElement[];
      const members = group.length > 0 ? group : [input];
      const marker = members[0] as Element;
      if (groupsDone.has(marker)) continue;
      groupsDone.add(marker);
      fields.push(readGroup(members, `f${fields.length}`, root));
    } else {
      fields.push(readSingle(control, `f${fields.length}`, root));
    }
  }
  return fields;
}

function buttonLabel(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) return cleanText(element.value).toLowerCase();
  return cleanText(element.textContent || element.getAttribute('aria-label')).toLowerCase();
}

function findPrimary(form: HTMLElement): CompanyForm['primaryButton'] {
  const scopes = [form, form.parentElement].filter((element): element is HTMLElement => Boolean(element));
  for (const scope of scopes) {
    const buttons = Array.from(scope.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]')).filter(isVisible);
    for (const wanted of PRIMARY_BUTTONS) {
      const found = buttons.find((button) => wanted.texts.some((text) => buttonLabel(button) === text || buttonLabel(button).startsWith(`${text} `)));
      if (found) return wanted.action;
    }
  }
  return null;
}

function pageSaysDone(doc: Document, href: string): boolean {
  if (SUCCESS_PATH.test(href)) return true;
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, [role="status"]'));
  return headings.some((heading) => SUCCESS_TEXT.test(cleanText(heading.textContent)));
}

function blockedReason(doc: Document, fields: EasyApplyField[]): CompanyForm['blocked'] {
  // A captcha sitting under a real form is handled when submit fails to confirm. A page that is ONLY a captcha stops here.
  const captcha = doc.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="captcha"], #captcha');
  if (captcha && fields.length === 0) return 'captcha';
  const password = Array.from(doc.querySelectorAll('input[type="password"]')).find(isVisible);
  if (password && fields.filter((field) => field.kind !== 'resume').length < 4) return 'login';
  return '';
}

function formRoot(doc: Document): HTMLElement {
  const forms = Array.from(doc.querySelectorAll('form'));
  const richest = forms.map((form) => ({ form, count: form.querySelectorAll('input, select, textarea').length })).sort((left, right) => right.count - left.count)[0];
  if (richest && richest.count > 0) return richest.form;
  return doc.body;
}

export function readCompanyForm(doc: Document = document, href: string = doc.URL ?? ''): CompanyForm {
  if (pageSaysDone(doc, href)) {
    return { open: false, done: true, blocked: '', progress: '', fields: [], primaryButton: null, errors: [], signature: 'done' };
  }
  const root = formRoot(doc);
  const fields = readFields(root);
  const blocked = blockedReason(doc, fields);
  const primaryButton = blocked ? null : findPrimary(root);
  const progress = '';
  return {
    open: fields.length > 0 || Boolean(primaryButton),
    done: false,
    blocked,
    progress,
    fields,
    primaryButton,
    errors: fields.map((field) => field.error).filter(Boolean),
    signature: `${fields.map((field) => field.label).join('|')}|${primaryButton ?? ''}|${blocked}|${fields.map((field) => field.error).join('|')}`,
  };
}
