/**
 * FILE: matching/skillSynonyms.ts
 * WHAT: Normalizes skill names so "ReactJS", "React.js" and "react" all count as the same skill.
 * CALLED BY: matching/ruleScore.ts, matching/hardFilters.ts, steps/2-buildProfile.ts
 * IF IT BREAKS: a skill not matching its twin? Add a line to SKILL_SYNONYMS (left = variant, right = canonical).
 */

export const SKILL_SYNONYMS: Record<string, string> = {
  js: 'javascript', 'java script': 'javascript', ecmascript: 'javascript', es6: 'javascript',
  ts: 'typescript',
  reactjs: 'react', 'react js': 'react', 'react.js': 'react',
  'react native': 'react native', reactnative: 'react native',
  node: 'node.js', nodejs: 'node.js', 'node js': 'node.js',
  'next js': 'next.js', nextjs: 'next.js',
  'vue js': 'vue', vuejs: 'vue', 'vue.js': 'vue',
  angularjs: 'angular', 'angular js': 'angular',
  'express js': 'express', expressjs: 'express', 'express.js': 'express',
  k8s: 'kubernetes',
  'amazon web services': 'aws',
  gcp: 'google cloud', 'google cloud platform': 'google cloud',
  'ms sql': 'sql server', mssql: 'sql server',
  postgres: 'postgresql', psql: 'postgresql',
  mongo: 'mongodb', 'mongo db': 'mongodb',
  'spring boot': 'spring boot', springboot: 'spring boot',
  golang: 'go',
  py: 'python',
  'c sharp': 'c#', csharp: 'c#',
  'dot net': '.net', dotnet: '.net', 'asp.net': '.net',
  ml: 'machine learning', dl: 'deep learning', ai: 'artificial intelligence',
  'rest api': 'rest', 'restful api': 'rest', 'rest apis': 'rest', restful: 'rest',
  html5: 'html', css3: 'css',
  'tailwind css': 'tailwind', tailwindcss: 'tailwind',
  'ci cd': 'ci/cd', cicd: 'ci/cd',
};

/** lowercase, strip punctuation except . # + / (they matter in "c#", "c++", "node.js", "ci/cd"), map synonyms. */
export function normalizeSkill(skill: string): string {
  const cleaned = skill.toLowerCase().replace(/[^a-z0-9.#+/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return SKILL_SYNONYMS[cleaned] ?? SKILL_SYNONYMS[cleaned.replace(/\s/g, '')] ?? cleaned;
}

export function normalizeSkillSet(skills: string[]): Set<string> {
  return new Set(skills.map(normalizeSkill).filter(Boolean));
}
