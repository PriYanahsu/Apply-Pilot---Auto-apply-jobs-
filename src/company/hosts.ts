/**
 * FILE: company/hosts.ts
 * WHAT: Which company-application sites we can fill (Greenhouse, Lever, Ashby) and how to pull
 *       the real application URL out of a button, a link, or a LinkedIn/Naukri redirect.
 *       Workday and every other host are left for a manual apply.
 * CALLED BY: page readers, the company-site step, the job card.
 */
import type { StepName } from '../db/types';

export type AtsName = 'greenhouse' | 'lever' | 'ashby';

const ATS_HOSTS: { name: AtsName; suffix: string }[] = [
  { name: 'greenhouse', suffix: 'greenhouse.io' },
  { name: 'lever', suffix: 'lever.co' },
  { name: 'ashby', suffix: 'ashbyhq.com' },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (error) {
    console.log('[company] not a URL', url, error);
    return '';
  }
}

function isJobBoardHost(host: string): boolean {
  return host === 'naukri.com' || host.endsWith('.naukri.com') || host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

export function detectAts(url: string): AtsName | null {
  const host = hostOf(url);
  if (!host) return null;
  return ATS_HOSTS.find((ats) => host === ats.suffix || host.endsWith(`.${ats.suffix}`))?.name ?? null;
}

/** A real web page that is not Naukri or LinkedIn (a new tab is about:blank for a moment first). */
export function isOffsiteUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const host = hostOf(url);
  return host !== '' && !isJobBoardHost(host);
}

/**
 * The page that holds the form. Lever and Ashby show the description first and the form on /apply or /application.
 * boards.greenhouse.io often redirects to the company's own careers page; the embed URL keeps the form on Greenhouse.
 */
export function applyFormUrl(url: string): string {
  const ats = detectAts(url);
  if (!ats) return url;
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (ats === 'lever' && parts.length === 2) parsed.pathname = `/${parts[0]}/${parts[1]}/apply`;
  else if (ats === 'ashby' && parts.length === 2) parsed.pathname = `/${parts[0]}/${parts[1]}/application`;
  else if (ats === 'greenhouse' && parsed.hostname === 'boards.greenhouse.io' && parts.length === 3 && parts[1] === 'jobs') {
    return `https://boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(parts[0] ?? '')}&token=${encodeURIComponent(parts[2] ?? '')}`;
  }
  return parsed.href;
}

/** Follows `?url=` redirects. A URL that is still on Naukri or LinkedIn is not a company site. */
export function companyUrlFromHref(href: string, base?: string): string {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^javascript:/i.test(trimmed)) return '';
  try {
    return unwrap(new URL(trimmed, base ?? 'https://example.invalid').href, 0);
  } catch (error) {
    console.log('[company] could not read href', href, error);
    return '';
  }
}

function unwrap(href: string, depth: number): string {
  if (depth > 3) return '';
  const url = new URL(href);
  if (url.hostname === 'example.invalid') return '';
  if (isJobBoardHost(url.hostname)) {
    const inner = url.searchParams.get('url') || url.searchParams.get('redirect') || '';
    return /^https?:\/\//i.test(inner) ? unwrap(inner, depth + 1) : '';
  }
  return url.href;
}

/** The apply control's own link wins. If it has none, the first Greenhouse / Lever / Ashby link on the page. */
export function pickCompanyUrl(controlHrefs: Array<string | null | undefined>, pageHrefs: Array<string | null | undefined>, base?: string): string {
  const fromControl = controlHrefs.map((href) => (href ? companyUrlFromHref(href, base) : '')).find(Boolean);
  if (fromControl) return fromControl;
  return pageHrefs.map((href) => (href ? companyUrlFromHref(href, base) : '')).find((url) => url && detectAts(url)) ?? '';
}

export function controlHrefs(control: Element | null | undefined): string[] {
  if (!control) return [];
  const elements = [control, control.closest('a')].filter((element): element is Element => Boolean(element));
  return elements.flatMap((element) => ['href', 'data-url', 'data-href'].map((name) => element.getAttribute(name) ?? '')).filter(Boolean);
}

/** "Redirected to https://..." from the apply result. */
export function companyUrlFromText(text: string): string {
  const match = text.match(/https?:\/\/[^\s)]+/);
  return match ? companyUrlFromHref(match[0]) : '';
}

/**
 * Company-site apply is the last step, and only on a run that actually applies.
 * "Run both" holds it off the Naukri half (`holdForChainedRun`) so it runs once, after LinkedIn Easy Apply.
 * Find-only and single-job runs never include an apply step here, so they stay unchanged.
 */
export function appendCompanyStep(steps: StepName[], holdForChainedRun: boolean): StepName[] {
  const without = steps.filter((step) => step !== 'COMPANY_APPLYING');
  if (holdForChainedRun) return without;
  const appliesInPlatform = without.includes('APPLYING') || without.includes('LI_APPLYING');
  return appliesInPlatform ? [...without, 'COMPANY_APPLYING'] : without;
}
