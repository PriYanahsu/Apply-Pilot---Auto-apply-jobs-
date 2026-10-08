/**
 * FILE: linkedin/selectors.ts
 * WHAT: Every LinkedIn selector and text marker, with fallbacks (rule R9).
 *       LinkedIn's class names are scrambled (e.g. "fmbk01 e0sle3") and change often, so we rely ONLY on stable
 *       hooks seen on the live site (Oct 2026): aria-label, componentkey, data-testid, data-sdui-screen, roles, text.
 * CALLED BY: linkedin/*.ts (content script side)
 * IF IT BREAKS: Debug > Snapshots has the page HTML; add the new hook at the START of the key's list.
 */

export const LI_SEL = {
  // Search results: <div role="button" componentkey="job-card-component-ref-4475438772"> (new UI),
  // older UI / guest page fallbacks after it.
  searchCard: ['[componentkey^="job-card-component-ref-"]', 'li[data-occludable-job-id]', '[data-job-id]', '.base-search-card[data-entity-urn]'],
  // Job details
  jobDetails: ['[data-sdui-screen*="JobDetails"]', '.jobs-search__job-details', '.job-view-layout', 'main'],
  easyApplyButton: ['button[aria-label*="Easy Apply"]', 'a[aria-label*="Easy Apply"]'],
  externalApplyButton: ['button[aria-label*="company website"]', 'a[aria-label*="company website"]', 'a[aria-label*="Apply on"]'],
  companyLink: ['a[href*="/company/"]'],
  // The job text itself, in the layouts seen so far (classic ids/classes are stable; new UI uses "About the job").
  jobDescription: ['#job-details', '.jobs-description__content', '.jobs-description-content__text', '.jobs-box__html-content', '[data-testid="expandable-text-box"]', '.show-more-less-html__markup'],
  // Easy Apply dialog: data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.easyapply.EasyApply", data-testid="dialog-content"
  dialog: ['[data-sdui-screen*="easyapply" i]', '[data-testid="dialog-content"]', '.jobs-easy-apply-modal', 'dialog[open]', '[role="dialog"]'],
  dismissButton: ['button[aria-label="Dismiss"]', 'button[aria-label*="Dismiss"]', 'button[aria-label*="Close"]'],
  // One question block: componentkey="easyApplyFieldFocus_ea.q::37187271074::FIRST_NAME::firstName.validation"
  fieldBlock: ['[componentkey^="easyApplyFieldFocus"]', '.jobs-easy-apply-form-section__grouping', '.fb-dash-form-element', 'fieldset'],
  fieldError: ['[role="alert"]', '.artdeco-inline-feedback--error', '[id*="error"]'],
  typeaheadOption: ['[role="listbox"] [role="option"]', '[role="option"]', '.basic-typeahead__selectable'],
} as const;

export type LinkedInSelectorKey = keyof typeof LI_SEL;

/** Easy Apply footer buttons, most important first (we click the first one present). */
export const LI_PRIMARY_BUTTONS = [
  { action: 'submit', texts: ['submit application', 'submit'] },
  { action: 'review', texts: ['review your application', 'review'] },
  { action: 'next', texts: ['next', 'continue to next step', 'continue'] },
] as const;
export type LinkedInPrimaryAction = 'submit' | 'review' | 'next';

export const LI_TEXT = {
  applicationSent: /application (was )?sent|your application was sent|applied to .* successfully/i,
  jobApplied: /^(applied\b|application submitted)/i,
  // "Not currently accepting applications" / "No longer accepting applications"
  jobClosed: /(not currently|no longer) accepting applications|applications (are )?closed|job is closed/i,
  dailyLimit: /easy apply (application )?limit|reached the (daily )?limit|limit for today|try again tomorrow/i,
  securityCheck: /security check|verify (that )?you('|’)?re (a )?human|let('|’)?s do a quick/i,
  posted: /(reposted\s+)?(\d+\s+(minute|hour|day|week|month)s?\s+ago|just now|today|yesterday)/i,
  progress: /(\d+)\s*\/\s*(\d+)\s*pages?/i,
  resumeFile: /\.(pdf|docx?)\b/i,
  discard: ['discard'],
  done: ['done', 'not now'],
} as const;

/** https://www.linkedin.com/jobs/view/4475438772/ */
export const LI_JOB_ID_IN_URL = /\/jobs\/view\/(\d+)|currentJobId=(\d+)/;
