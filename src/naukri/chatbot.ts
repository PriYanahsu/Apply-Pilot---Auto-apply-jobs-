/**
 * FILE: naukri/chatbot.ts
 * WHAT: Talks to Naukri's screening-question chatbot: read the latest question (and its answer options),
 *       fill an answer (type text / click a chip / pick a radio, checkbox or dropdown option), and send it.
 *       Structure checked on the live site - see the chat* keys in selectors.ts.
 * CALLED BY: entrypoints/naukri.content.ts (READ_CHATBOT, ANSWER_CHATBOT, WAIT_CHATBOT_CHANGE)
 * RETURNS: ChatbotState { state: 'question' | 'success' | 'closed', question, inputType, options }
 * IF IT BREAKS: questions read as empty -> SEL.chatBotMessage; options missing -> SEL.chatChipOption / chatLoadMore;
 *               answer not sent -> SEL.chatSend. Debug > Snapshots has the page HTML of every failure.
 */
import { APPLY_SUCCESS_TEXTS } from './selectors';
import {
  cleanText, fillText, humanClick, isVisible, makeError, pageTextIncludes, queryAll, queryOptional, queryVisible, waitForCondition,
} from './domHelpers';
import { sleep } from '../shared/sleep';
import type { ChatbotState, ChatInputType } from '../shared/messages';

const LOAD_MORE_ROUNDS = 3;
const AFTER_CLICK_SETTLE_MS = 800;
const DRAWER_HTML_MAX_CHARS = 40_000;
const SETTLE_INTERVAL_MS = 500;
const SETTLE_STABLE_LOOKS = 3; // unchanged for 3 looks in a row (~1.5 s) = fully drawn
const SETTLE_MAX_LOOKS = 12; // ~6 s at most

/** Reads the chatbot right now (no waiting). Used inside waitChatbotChange's polling too. */
export function readChatbot(): ChatbotState {
  const drawer = queryVisible(document, 'chatDrawer');
  if (!drawer) {
    const succeeded = queryVisible(document, 'applySuccess') !== null || pageTextIncludes(APPLY_SUCCESS_TEXTS);
    return { state: succeeded ? 'success' : 'closed', question: '', inputType: 'text', options: [] };
  }
  // The newest bubble can be an empty "typing..." indicator while the bot writes; use the newest one with text.
  const botTexts = queryAll(drawer, 'chatBotMessage').map((message) => cleanText(message.textContent)).filter(Boolean);
  const question = botTexts[botTexts.length - 1] ?? '';
  const { inputType, options } = readInputType(drawer);
  return { state: 'question', question, inputType, options };
}

/**
 * Naukri shows the question bubble first and draws its options (chips / checkboxes / radios) a moment later.
 * Reading too early turns a tick-box question into a "text" question. So read until two looks in a row agree.
 */
export async function readChatbotSettled(): Promise<ChatbotState> {
  let previous = readChatbot();
  let stableLooks = 0;
  for (let look = 0; look < SETTLE_MAX_LOOKS; look += 1) {
    await sleep(SETTLE_INTERVAL_MS);
    const current = readChatbot();
    const same = current.question === previous.question && current.inputType === previous.inputType && current.options.join('|') === previous.options.join('|');
    stableLooks = same ? stableLooks + 1 : 0;
    previous = current;
    if (stableLooks >= SETTLE_STABLE_LOOKS) return current;
  }
  return previous;
}

/** READ_CHATBOT: waits for the question to finish appearing, clicks "Load more" so the AI sees ALL options, then reads. */
export async function readChatbotWithAllOptions(): Promise<ChatbotState> {
  await readChatbotSettled();
  const drawer = queryVisible(document, 'chatDrawer');
  if (drawer) await expandLoadMore(drawer);
  return { ...readChatbot(), drawerHtml: drawer?.outerHTML.slice(0, DRAWER_HTML_MAX_CHARS) };
}

function findLoadMore(drawer: HTMLElement): HTMLElement | null {
  const candidates = queryAll(drawer, 'chatLoadMore');
  return candidates.find((element) => isVisible(element) && /load more|show more|more options/i.test(cleanText(element.textContent))) ?? null;
}

async function expandLoadMore(drawer: HTMLElement): Promise<void> {
  for (let round = 0; round < LOAD_MORE_ROUNDS; round += 1) {
    const loadMore = findLoadMore(drawer);
    if (!loadMore) return;
    await humanClick(loadMore);
    await sleep(AFTER_CLICK_SETTLE_MS);
  }
}

function labelFor(input: HTMLInputElement): string {
  const root = input.getRootNode() as ParentNode;
  const byFor = input.id ? Array.from(root.querySelectorAll('label')).find((label) => label.htmlFor === input.id) : undefined;
  return cleanText((byFor ?? input.closest('label') ?? input.parentElement)?.textContent) || input.value;
}

const LOAD_MORE_TEXT = /^(load more|show more)$/i;

/** Real answer chips only: inside chipsContainer, innermost "chip" element, has text, not the "Load more" link. */
function chipElements(drawer: HTMLElement): HTMLElement[] {
  const chips = queryAll(drawer, 'chatChipOption').filter((element) => {
    const text = cleanText(element.textContent);
    const hasInnerChip = element.querySelector('[class*="chip"], [class*="Chip"]') !== null;
    return text !== '' && !hasInnerChip && !LOAD_MORE_TEXT.test(text) && isVisible(element);
  });
  // A chip like <div class="chip"><span>BPM</span></div> can also match the "span" fallback: keep the outer one.
  return chips.filter((chip) => !chips.some((other) => other !== chip && other.contains(chip)));
}

function optionText(element: HTMLElement): string {
  return element instanceof HTMLInputElement ? labelFor(element) : cleanText(element.textContent);
}

type OptionKey = 'chatRadioOption' | 'chatCheckboxOption' | 'chatChipOption';

/** Option elements of the CURRENT question: visible and still clickable (answered ones stay in the history, disabled). */
function liveOptionElements(drawer: HTMLElement, key: OptionKey): HTMLElement[] {
  if (key === 'chatChipOption') return chipElements(drawer);
  return queryAll(drawer, key).filter((element) => !(element as HTMLInputElement).disabled && optionText(element) !== '');
}

function liveOptions(drawer: HTMLElement, key: OptionKey): string[] {
  return Array.from(new Set(liveOptionElements(drawer, key).map(optionText)));
}

/** A question is radio / checkbox / chips ONLY if those options have real text; otherwise it is a text question. */
export function readInputType(drawer: HTMLElement): { inputType: ChatInputType; options: string[] } {
  const radios = liveOptions(drawer, 'chatRadioOption');
  if (radios.length > 0) return { inputType: 'radio', options: radios };
  const checkboxes = liveOptions(drawer, 'chatCheckboxOption');
  if (checkboxes.length > 0) return { inputType: 'checkbox', options: checkboxes };
  const dropdown = queryOptional(drawer, 'chatDropdown') as HTMLSelectElement | null;
  const dropdownOptions = dropdown ? Array.from(dropdown.options).map((option) => cleanText(option.text)).filter(Boolean) : [];
  if (dropdownOptions.length > 0) return { inputType: 'dropdown', options: dropdownOptions };
  const chips = liveOptions(drawer, 'chatChipOption');
  if (chips.length > 0) return { inputType: 'chips', options: chips };
  return { inputType: 'text', options: [] };
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** Fills the answer and sends it. If `send` is false (test mode) it stops before sending. */
export async function answerChatbot(answer: string | string[], inputType: ChatInputType, send: boolean): Promise<{ sent: boolean }> {
  const drawer = queryVisible(document, 'chatDrawer');
  if (!drawer) throw makeError('SELECTOR_MISSING', 'Chatbot drawer is not open', 'chatDrawer');
  const answers = Array.isArray(answer) ? answer : [answer];

  if (inputType === 'text') {
    const textInput = queryVisible(drawer, 'chatTextInput') ?? queryOptional(drawer, 'chatTextInput');
    if (!textInput) throw makeError('SELECTOR_MISSING', 'Chatbot text input not found', 'chatTextInput');
    await fillText(textInput, answers.join(', '));
  } else if (inputType === 'dropdown') {
    const dropdown = queryOptional(drawer, 'chatDropdown') as HTMLSelectElement | null;
    const wanted = answers[0] ?? '';
    const option = dropdown ? Array.from(dropdown.options).find((item) => sameText(item.text, wanted)) : undefined;
    if (!dropdown || !option) throw makeError('SELECTOR_MISSING', `Dropdown option "${wanted}" not found`, 'chatDropdown');
    dropdown.value = option.value;
    dropdown.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    await clickOptions(drawer, inputType, answers);
  }
  if (!send) return { sent: false };
  return { sent: await pressSendIfShown(drawer, inputType) };
}

/**
 * Text answers need the Send button. For chips Naukri hides Send (the chip click already sent the answer),
 * so a missing Send there is fine. Radio / checkbox / dropdown usually need Send ("Save").
 */
async function pressSendIfShown(drawer: HTMLElement, inputType: ChatInputType): Promise<boolean> {
  await sleep(AFTER_CLICK_SETTLE_MS);
  const sendButton = queryVisible(drawer, 'chatSend');
  if (sendButton) {
    await humanClick(sendButton);
    return true;
  }
  if (inputType === 'chips') return true;
  const textInput = queryOptional(drawer, 'chatTextInput');
  if (inputType === 'text' && textInput) {
    // Fallback: Enter in the text box also sends on Naukri's chatbot.
    textInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return true;
  }
  throw makeError('SELECTOR_MISSING', 'Chatbot Send/Save button not found', 'chatSend');
}

async function clickOptions(drawer: HTMLElement, inputType: ChatInputType, answers: string[]): Promise<void> {
  const key: OptionKey = inputType === 'radio' ? 'chatRadioOption' : inputType === 'checkbox' ? 'chatCheckboxOption' : 'chatChipOption';
  for (const wanted of answers) {
    let match = liveOptionElements(drawer, key).find((element) => sameText(optionText(element), wanted));
    if (!match && key === 'chatChipOption') {
      await expandLoadMore(drawer); // the option may be behind "Load more"
      match = liveOptionElements(drawer, key).find((element) => sameText(optionText(element), wanted));
    }
    if (!match) throw makeError('SELECTOR_MISSING', `Option "${wanted}" not found in chatbot`, key);
    await humanClick(match);
  }
}

/** Waits until the bot shows a different question (fully drawn, options included), says success, or closes. */
export async function waitChatbotChange(previousQuestion: string, timeoutMs: number): Promise<ChatbotState> {
  const changed = await waitForCondition(() => {
    const current = readChatbot();
    if (current.state !== 'question') return current;
    return current.question && current.question !== previousQuestion ? current : null;
  }, timeoutMs, 'Chatbot did not move to the next question');
  return changed.state === 'question' ? readChatbotSettled() : changed;
}
