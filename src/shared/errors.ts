/**
 * FILE: shared/errors.ts
 * WHAT: makeError(code, message) - a normal Error with a .code (and optional .selectorKey) attached,
 *       so callers can decide what to do: pause on CAPTCHA, stop on NOT_LOGGED_IN, mark the job failed otherwise.
 * CALLED BY: naukri/*, orchestrator/*, steps/*
 */

export type AppErrorCode =
  | 'NOT_LOGGED_IN' | 'SELECTOR_MISSING' | 'TIMEOUT' | 'CAPTCHA' | 'UNKNOWN' | 'PAGE_CHANGED'
  | 'STOP_REQUESTED' | 'PAUSE_REQUESTED' | 'DAILY_LIMIT' | 'TOO_MANY_SELECTOR_FAILURES' | 'SETUP_MISSING'
  | 'GEMINI_QUOTA' | 'GEMINI_INVALID' | 'GEMINI_HTTP' | 'GEMINI_NO_KEY';

export type CodedError = Error & { code: AppErrorCode; selectorKey?: string };

export function makeError(code: AppErrorCode, message: string, selectorKey?: string): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  error.selectorKey = selectorKey;
  return error;
}

export function errorCode(error: unknown): AppErrorCode {
  return (error as Partial<CodedError>)?.code ?? 'UNKNOWN';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
