/**
 * FILE: matching/roleFamily.ts
 * WHAT: Puts a job title into a field ("role family"): developer, testing, content, sales, support...
 *       Your fields come from your RESUME first (your recent jobs), then your current title / site headline and
 *       target roles. A job in a field you have no experience in is skipped before any AI is used:
 *       a developer is not sent to "Automation Tester" or "Technical Editor" jobs.
 * CALLED BY: matching/hardFilters.ts, steps/4-filterJobs.ts
 * IF IT BREAKS: a title in the wrong field? Add its word to the right FAMILY_PATTERNS line (order matters:
 *       the first match wins, so specific fields like testing come before the broad "developer").
 */
import type { CandidateProfile } from '../db/types';

export type RoleFamily =
  | 'testing' | 'content' | 'design' | 'sales_marketing' | 'support' | 'hr' | 'management'
  | 'business_analyst' | 'data_ai' | 'devops' | 'developer';

export const ROLE_FAMILY_NAMES: Record<RoleFamily, string> = {
  testing: 'testing / QA', content: 'content / writing', design: 'design', sales_marketing: 'sales / marketing',
  support: 'support', hr: 'HR / recruiting', management: 'project / product management', business_analyst: 'business analysis',
  data_ai: 'data / AI', devops: 'DevOps / cloud', developer: 'software development',
};

// First match wins. "Software Test Engineer" is testing, "Sales Engineer" is sales, "Data Engineer" is data.
const FAMILY_PATTERNS: [RoleFamily, RegExp][] = [
  ['testing', /\b(tester|testing|test (engineer|analyst|lead|architect)|qa|quality assurance|quality analyst|quality engineer|sdet|selenium|automation test)/],
  ['content', /\b(editor|writer|content|copywriter|proof ?reader|journalist|author|documentation specialist)\b/],
  ['design', /\b(designer|ui ?\/ ?ux|ux|graphic|illustrator|animator|visual design)\b/],
  ['sales_marketing', /\b(sales|marketing|business development|bde|bdm|seo|sem|telecaller|tele ?caller|lead generation|presales|pre-sales|account (manager|executive)|growth)\b/],
  ['support', /\b(support|help ?desk|service desk|customer (service|care|success)|technical assistance|desktop engineer|l1|l2)\b/],
  ['hr', /\b(hr|human resources?|recruiter|recruitment|talent acquisition|payroll)\b/],
  ['management', /\b(project manager|product manager|program manager|delivery manager|scrum master|product owner)\b/],
  ['business_analyst', /\b(business analyst|functional consultant|ba)\b/],
  ['data_ai', /\b(data (scientist|analyst|engineer|analytics)|analytics|machine learning|ml engineer|ai engineer|ai\/ml|deep learning|nlp|computer vision|mlops|bi developer|power bi|tableau)\b/],
  ['devops', /\b(devops|dev ops|sre|site reliability|cloud (engineer|architect|administrator)|platform engineer|system administrator|sysadmin|network engineer|infrastructure)\b/],
  ['developer', /\b(developer|programmer|sde|swe|software|engineer|full ?stack|front ?end|back ?end|web|mobile|android|ios|flutter|react|angular|node|java|python|\.net|php|golang|architect|coder|mern|mean)\b/],
];

/** The field of one job title, or undefined when the title doesn't say (e.g. "Associate", "Analyst"). */
export function roleFamily(title: string): RoleFamily | undefined {
  const lower = ` ${title.toLowerCase().replace(/[^a-z0-9.+#/ ]+/g, ' ')} `;
  return FAMILY_PATTERNS.find(([, pattern]) => pattern.test(lower))?.[0];
}

// Only your recent jobs count: an internship from years ago doesn't make you a candidate for that field today.
const RECENT_JOBS_FOR_FIELD = 2;

/**
 * Your fields: resume first (your most recent jobs), then your current title / headline and your target roles.
 * Empty when nothing is known - then no job is skipped for its field.
 */
export function candidateFamilies(profile: Pick<CandidateProfile, 'currentTitle' | 'targetTitles' | 'workHistory'>): Set<RoleFamily> {
  const titles = [
    ...(profile.workHistory ?? []).slice(0, RECENT_JOBS_FOR_FIELD).map((entry) => entry.title),
    profile.currentTitle,
    ...profile.targetTitles,
  ];
  const families = new Set<RoleFamily>();
  for (const title of titles) {
    const family = title ? roleFamily(title) : undefined;
    if (family) families.add(family);
  }
  return families;
}

/** Why a job is in a field you don't work in, or null when it fits (or the field is unknown). */
export function roleMismatch(jobTitle: string, families: Set<RoleFamily>): string | null {
  if (families.size === 0) return null;
  const family = roleFamily(jobTitle);
  if (!family || families.has(family)) return null;
  const yours = Array.from(families).map((name) => ROLE_FAMILY_NAMES[name]).join(', ');
  return `Different field: this is a ${ROLE_FAMILY_NAMES[family]} job; your experience is ${yours}`;
}
