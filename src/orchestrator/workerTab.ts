/**
 * FILE: orchestrator/workerTab.ts
 * WHAT: Owns the ONE background Naukri tab the extension works in (rule R6), navigates it, and sends
 *       commands to the content script inside it with a timeout + Zod validation of the reply.
 * CALLED BY: steps/*
 * RETURNS: sendToContent -> validated data, or throws a CodedError (NOT_LOGGED_IN, CAPTCHA, SELECTOR_MISSING, TIMEOUT...).
 * IF IT BREAKS: "content script not responding" -> reload the extension and close the old worker tab.
 */
import type { z } from 'zod';
import {
  CHATBOT_ANSWER_TIMEOUT_MS, CONTENT_COMMAND_TIMEOUT_MS, NAUKRI_LOGIN_URL_MARKERS, PAGE_LOAD_TIMEOUT_MS, PAGE_SETTLE_DELAY_MS,
} from '../config';
import { db } from '../db/database';
import { makeError } from '../shared/errors';
import { log } from '../shared/log';
import type { AnyContentCommand, CommandResult } from '../shared/messages';
import { randomDelay, sleep } from '../shared/sleep';

const WORKER_TAB_STORAGE_KEY = 'workerTabId';
const PING_ATTEMPTS = 10;
const PING_RETRY_DELAY_MS = 500;

// Two callers asking at the same moment must get the SAME tab, never two new ones.
let pendingWorkerTab: Promise<number> | null = null;

/** Reuses the saved worker tab if it still exists, otherwise opens ONE new inactive one. */
export async function getWorkerTabId(): Promise<number> {
  if (!pendingWorkerTab) pendingWorkerTab = findOrCreateWorkerTab().finally(() => { pendingWorkerTab = null; });
  return pendingWorkerTab;
}

async function findOrCreateWorkerTab(): Promise<number> {
  // chrome.storage.session survives service-worker restarts but not browser restarts - exactly what we want.
  const stored = await chrome.storage.session.get(WORKER_TAB_STORAGE_KEY);
  const savedTabId = stored[WORKER_TAB_STORAGE_KEY] as number | undefined;
  if (savedTabId !== undefined) {
    try {
      const existing = await chrome.tabs.get(savedTabId);
      if (existing.id !== undefined) return existing.id;
    } catch (error) {
      // Normal: the user closed the worker tab. We just open a new one below.
      console.warn('[workerTab] saved worker tab is gone, opening a new one', error);
    }
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (tab.id === undefined) throw makeError('UNKNOWN', 'Chrome did not give the worker tab an id');
  await chrome.storage.session.set({ [WORKER_TAB_STORAGE_KEY]: tab.id });
  return tab.id;
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(makeError('TIMEOUT', `Page did not finish loading in ${PAGE_LOAD_TIMEOUT_MS} ms`));
    }, PAGE_LOAD_TIMEOUT_MS);
    function listener(updatedTabId: number, changeInfo: { status?: string }) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Opens `url` in the worker tab, waits for it to load and settle. Returns the final URL (after redirects). */
export async function navigateWorkerTab(url: string): Promise<string> {
  const tabId = await getWorkerTabId();
  const loaded = waitForTabComplete(tabId);
  await chrome.tabs.update(tabId, { url });
  try {
    await loaded;
  } catch (error) {
    // LinkedIn keeps loading things forever; the page is usable long before "complete". Naukri keeps the strict check.
    if (!url.includes('linkedin.com')) throw error;
    console.log('[workerTab] LinkedIn page still loading after the timeout - continuing', error);
  }
  // Naukri renders most content with JavaScript after the load event, so give it a human-like moment.
  await randomDelay(PAGE_SETTLE_DELAY_MS);
  const tab = await chrome.tabs.get(tabId);
  return tab.url ?? '';
}

export function isLoginUrl(url: string): boolean {
  return NAUKRI_LOGIN_URL_MARKERS.some((marker) => url.includes(marker));
}

export async function getWorkerTabUrl(): Promise<string> {
  const tab = await chrome.tabs.get(await getWorkerTabId());
  return tab.url ?? '';
}

// Chrome's wording when the page navigated / reloaded while a command was still running.
const PAGE_CHANGED_MESSAGES = ['message channel closed', 'receiving end does not exist', 'message port closed', 'back/forward cache'];

async function sendMessageToTab(tabId: number, command: AnyContentCommand): Promise<CommandResult<unknown>> {
  try {
    return (await chrome.tabs.sendMessage(tabId, command)) as CommandResult<unknown>;
  } catch (error) {
    const text = String(error).toLowerCase();
    // Not a real failure: e.g. clicking Apply makes Naukri open a new page, which ends the old page's script.
    if (PAGE_CHANGED_MESSAGES.some((message) => text.includes(message))) {
      throw makeError('PAGE_CHANGED', `The Naukri page changed while running ${command.type}`);
    }
    throw error;
  }
}

async function sendRaw(tabId: number, command: AnyContentCommand, timeoutMs: number): Promise<CommandResult<unknown>> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(makeError('TIMEOUT', `Content script did not answer ${command.type} in ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([sendMessageToTab(tabId, command), timeout]);
}

/** The content script loads a moment after the page; ping until it answers. */
async function waitForContentScript(tabId: number): Promise<void> {
  for (let attempt = 1; attempt <= PING_ATTEMPTS; attempt += 1) {
    try {
      const reply = await sendRaw(tabId, { type: 'PING' }, 2_000);
      if (reply?.ok) return;
    } catch (error) {
      if (attempt === PING_ATTEMPTS) {
        throw makeError('TIMEOUT', `Content script not responding on the Naukri tab: ${String(error)}`);
      }
    }
    await sleep(PING_RETRY_DELAY_MS);
  }
}

export interface SendContext {
  step: string;
  jobId?: string;
}

/** Sends one command, validates the reply, saves a debug snapshot on failure, and throws a CodedError. */
export async function sendToContent<T>(command: AnyContentCommand, schema: z.ZodType<T>, context: SendContext): Promise<T> {
  const tabId = await getWorkerTabId();
  await waitForContentScript(tabId);
  const commandTimeout = 'timeoutMs' in command ? command.timeoutMs + 5_000
    : command.type === 'ANSWER_CHATBOT' || command.type.startsWith('LI_') ? CHATBOT_ANSWER_TIMEOUT_MS : CONTENT_COMMAND_TIMEOUT_MS;
  const reply = await sendRaw(tabId, command, commandTimeout);
  if (!reply.ok) {
    if (reply.error.snapshot) {
      await db.debugSnapshots.add({
        ts: new Date().toISOString(), jobId: context.jobId, step: context.step,
        selectorKey: reply.error.selectorKey ?? reply.error.code, ...reply.error.snapshot,
      });
    }
    throw makeError(reply.error.code, reply.error.message, reply.error.selectorKey);
  }
  const parsed = schema.safeParse(reply.data);
  if (!parsed.success) {
    await log(context.step, `Bad reply from content script for ${command.type}`, { jobId: context.jobId, level: 'error', data: parsed.error.issues.slice(0, 3) });
    throw makeError('UNKNOWN', `Bad reply from content script for ${command.type}`);
  }
  return parsed.data;
}
