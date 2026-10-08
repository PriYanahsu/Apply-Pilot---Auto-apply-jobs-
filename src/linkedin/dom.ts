/**
 * FILE: linkedin/dom.ts
 * WHAT: Small DOM helpers for LinkedIn pages: find by fallback list, read only the VISIBLE text of an element
 *       (LinkedIn repeats every title in an aria-hidden span), find buttons by their text.
 * CALLED BY: linkedin/*.ts (content script side)
 */
import { cleanText, isVisible } from '../naukri/domHelpers';
import { LI_SEL, type LinkedInSelectorKey } from './selectors';

export function liQuery(root: ParentNode, key: LinkedInSelectorKey): HTMLElement | null {
  for (const selector of LI_SEL[key]) {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).find(isVisible);
    if (found) return found;
  }
  return null;
}

export function liQueryAll(root: ParentNode, key: LinkedInSelectorKey): HTMLElement[] {
  for (const selector of LI_SEL[key]) {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (found.length > 0) return found;
  }
  return [];
}

/** "Title Title" -> "Title" (LinkedIn prints many labels twice: once visible, once for screen readers). */
function withoutRepeat(text: string): string {
  const half = Math.floor(text.length / 2);
  const first = text.slice(0, half).trim();
  return text.length > 1 && first === text.slice(half).trim() ? first : text;
}

/**
 * Text a person sees, once. LinkedIn repeats labels: the new UI adds an aria-hidden copy, the classic UI puts the
 * visible text in aria-hidden and a copy in .visually-hidden. Drop the screen-reader copy; if nothing is left,
 * fall back to the full text with the repeat removed.
 */
export function visibleText(element: Element | null | undefined): string {
  if (!element) return '';
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('svg, style, script').forEach((node) => node.remove());
  const withoutScreenReaderCopy = copy.cloneNode(true) as Element;
  withoutScreenReaderCopy.querySelectorAll('.visually-hidden, .sr-only').forEach((node) => node.remove());
  const afterVisuallyHidden = cleanText(withoutScreenReaderCopy.textContent);
  withoutScreenReaderCopy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  const afterAriaHidden = cleanText(withoutScreenReaderCopy.textContent);
  return afterAriaHidden || afterVisuallyHidden || withoutRepeat(cleanText(copy.textContent));
}

/** Visible button (or role=button) whose text equals / starts with one of `texts` (lowercase). */
export function liButtonByText(root: ParentNode, texts: readonly string[], exact = true): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"], a[role="button"]'));
  for (const button of buttons) {
    const label = (visibleText(button) || button.getAttribute('aria-label') || '').toLowerCase();
    const matches = texts.some((text) => (exact ? label === text : label.startsWith(text)));
    if (matches && isVisible(button) && !(button as HTMLButtonElement).disabled) return button;
  }
  return null;
}

/** The Easy Apply dialog, if open. */
export function findEasyApplyDialog(): HTMLElement | null {
  return liQuery(document, 'dialog');
}
