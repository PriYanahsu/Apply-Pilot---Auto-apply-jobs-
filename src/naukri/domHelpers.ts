/**
 * FILE: naukri/domHelpers.ts
 * WHAT: query() / waitFor() / humanClick() / fillText() and small text helpers for Naukri pages.
 * CALLED BY: the naukri/read*.ts, clickApply.ts and chatbot.ts files (content script side only).
 * IF IT BREAKS: a thrown error with code SELECTOR_MISSING names the selector key - fix it in selectors.ts.
 */
import { CAPTCHA_TEXTS, SEL, type SelectorKey } from './selectors';
import { HUMAN_CLICK_DELAY_MS, HUMAN_TYPE_DELAY_MS } from '../config';
import { randomDelay } from '../shared/sleep';
import { makeError } from '../shared/errors';

export { makeError };
export type { CodedError } from '../shared/errors';

/** True when the element is actually rendered on screen (hidden templates and toasts don't count). */
export function isVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  if (htmlElement.getClientRects().length === 0) return false;
  const style = getComputedStyle(htmlElement);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

/** First VISIBLE element matching any fallback of `key`, or null. Use this for anything that proves a state. */
export function queryVisible(root: ParentNode, key: SelectorKey): HTMLElement | null {
  for (const selector of SEL[key]) {
    const visible = Array.from(root.querySelectorAll<HTMLElement>(selector)).find(isVisible);
    if (visible) return visible;
  }
  return null;
}

/** First element matching any fallback of `key`, or null. */
export function queryOptional(root: ParentNode, key: SelectorKey): HTMLElement | null {
  for (const selector of SEL[key]) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

/** Like queryOptional, but throws SELECTOR_MISSING (with the key) when nothing matches. */
export function query(root: ParentNode, key: SelectorKey): HTMLElement {
  const element = queryOptional(root, key);
  if (!element) throw makeError('SELECTOR_MISSING', `Naukri layout changed: "${key}" not found`, key);
  return element;
}

/** All elements for the first fallback of `key` that matches anything. */
export function queryAll(root: ParentNode, key: SelectorKey): HTMLElement[] {
  for (const selector of SEL[key]) {
    const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (elements.length > 0) return elements;
  }
  return [];
}

export function cleanText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function textOf(root: ParentNode, key: SelectorKey): string {
  return cleanText(queryOptional(root, key)?.textContent);
}

/** Waits (using a MutationObserver, not polling) until `key` appears. Throws TIMEOUT. */
export function waitFor(key: SelectorKey, timeoutMs: number, root: ParentNode = document): Promise<HTMLElement> {
  const existing = queryOptional(root, key);
  if (existing) return Promise.resolve(existing);
  return waitForCondition(() => queryOptional(root, key), timeoutMs, `Timed out waiting for "${key}"`);
}

/** Generic MutationObserver wait: resolves with the first truthy value of `check()`. */
export function waitForCondition<T>(check: () => T | null | undefined | false, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const first = check();
    if (first) return resolve(first);
    const observer = new MutationObserver(() => {
      const value = check();
      if (!value) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(makeError('TIMEOUT', timeoutMessage));
    }, timeoutMs);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
  });
}

/** Scrolls into view, waits a little like a person would, then fires real-looking mouse events + click(). */
export async function humanClick(element: HTMLElement): Promise<void> {
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await randomDelay(HUMAN_CLICK_DELAY_MS);
  const eventOptions = { bubbles: true, cancelable: true, view: window };
  element.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
  element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
  element.dispatchEvent(new PointerEvent('pointerup', eventOptions));
  element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
  element.click();
}

/**
 * Puts the WHOLE text into an <input>, <textarea> or contenteditable div at once.
 * (Typing letter by letter made long answers take 20+ s, longer than the command time limit, and Chrome
 * slows timers in background tabs even more.) A short human-like pause comes after, before Send.
 */
export async function fillText(element: HTMLElement, text: string): Promise<void> {
  element.focus();
  // insertText behaves like real typing/pasting, so the page's own (React) code notices the new text.
  const isEditableBox = element.isContentEditable || element.getAttribute('contenteditable') === 'true';
  if (isEditableBox) {
    document.getSelection()?.selectAllChildren(element);
    const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
    if (!inserted || cleanText(element.textContent) !== cleanText(text)) element.textContent = text;
  } else {
    setInputValue(element as HTMLInputElement, text);
  }
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await randomDelay(HUMAN_TYPE_DELAY_MS);
}

// React keeps its own copy of an input's value; using the native setter makes React notice the change.
function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
}

/** Finds a visible button/link whose text equals (or starts with) one of `texts` (lowercase). */
export function findButtonByText(texts: readonly string[], exact: boolean, root: ParentNode = document): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('button, a[role="button"], a.btn'));
  for (const candidate of candidates) {
    const label = cleanText(candidate.textContent).toLowerCase();
    const matches = texts.some((text) => (exact ? label === text : label.startsWith(text)));
    if (matches && isVisible(candidate)) return candidate;
  }
  return null;
}

export function pageTextIncludes(texts: readonly string[]): boolean {
  const pageText = (document.body?.innerText ?? '').toLowerCase();
  return texts.some((text) => pageText.includes(text));
}

const MIN_VISIBLE_CAPTCHA_HEIGHT_PX = 60;

// Many pages carry an INVISIBLE reCAPTCHA (badge or size=invisible iframe) for login forms.
// Only a captcha the user can actually see counts, otherwise every run would pause for nothing.
function isVisibleCaptcha(element: HTMLElement): boolean {
  if (element.closest('.grecaptcha-badge')) return false;
  if (element instanceof HTMLIFrameElement && element.src.includes('size=invisible')) return false;
  const box = element.getBoundingClientRect();
  return element.offsetParent !== null && box.height >= MIN_VISIBLE_CAPTCHA_HEIGHT_PX;
}

export function pageHasCaptcha(): boolean {
  const captchaElements = SEL.captcha.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)));
  return captchaElements.some(isVisibleCaptcha) || pageTextIncludes(CAPTCHA_TEXTS);
}
