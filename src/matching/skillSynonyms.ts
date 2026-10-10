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
  'redux toolkit': 'redux', rtk: 'redux',
  'nest js': 'nestjs', 'nest.js': 'nestjs',
  'nuxt js': 'nuxt', nuxtjs: 'nuxt', 'nuxt.js': 'nuxt',
  'svelte js': 'svelte', sveltekit: 'svelte',
  'django rest framework': 'django', drf: 'django',
  'fast api': 'fastapi',
  'spring framework': 'spring', 'spring mvc': 'spring',
  'microsoft azure': 'azure', 'ms azure': 'azure',
  'aws lambda': 'lambda',
  'my sql': 'mysql',
  'google bigquery': 'bigquery', 'big query': 'bigquery',
  'power bi': 'power bi', powerbi: 'power bi',
  'ms excel': 'excel', 'microsoft excel': 'excel', 'advanced excel': 'excel',
  'scikit learn': 'scikit-learn', sklearn: 'scikit-learn',
  'tensor flow': 'tensorflow',
  'py torch': 'pytorch',
  nlp: 'natural language processing',
  llm: 'large language models', llms: 'large language models', genai: 'generative ai', 'gen ai': 'generative ai',
  'github actions': 'github actions',
  'unit testing': 'unit testing', jest: 'jest',
  'material ui': 'material ui', mui: 'material ui',
  'styled components': 'styled-components',
  'web api': 'rest',
  'c plus plus': 'c++', cpp: 'c++',
  'objective c': 'objective-c',
  'shell scripting': 'bash', 'bash scripting': 'bash',
  'ms office': 'microsoft office',
  'data structures and algorithms': 'dsa', 'data structures': 'dsa',
  'object oriented programming': 'oops', oop: 'oops',
  'selenium webdriver': 'selenium',
  'manual testing': 'manual testing',
  'rest assured': 'rest assured',
  'sql server': 'sql server',
  'react hooks': 'react',
  'html/css': 'html',
};

/**
 * Common skills looked for inside a job DESCRIPTION when the job lists no skill tags (e.g. LinkedIn).
 * Canonical names (after normalizeSkill). Your own skills are always looked for as well.
 */
export const COMMON_SKILLS: string[] = [
  'javascript', 'typescript', 'react', 'react native', 'angular', 'vue', 'next.js', 'nuxt', 'svelte', 'node.js', 'express', 'nestjs',
  'html', 'css', 'sass', 'tailwind', 'bootstrap', 'redux', 'graphql', 'rest', 'webpack', 'vite', 'jquery',
  'java', 'spring', 'spring boot', 'hibernate', 'kotlin', 'scala', 'python', 'django', 'flask', 'fastapi',
  'c#', '.net', 'c++', 'go', 'rust', 'php', 'laravel', 'ruby', 'rails', 'swift', 'objective-c', 'flutter', 'dart', 'android', 'ios',
  'sql', 'mysql', 'postgresql', 'sql server', 'oracle', 'mongodb', 'redis', 'elasticsearch', 'cassandra', 'dynamodb', 'firebase', 'bigquery', 'snowflake',
  'aws', 'azure', 'google cloud', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'ci/cd', 'github actions', 'linux', 'bash', 'git',
  'kafka', 'rabbitmq', 'microservices', 'spark', 'hadoop', 'airflow', 'etl', 'power bi', 'tableau', 'excel',
  'machine learning', 'deep learning', 'natural language processing', 'computer vision', 'tensorflow', 'pytorch', 'scikit-learn',
  'pandas', 'numpy', 'large language models', 'generative ai',
  'selenium', 'cypress', 'playwright', 'jest', 'junit', 'manual testing', 'rest assured', 'jira',
  'figma', 'salesforce', 'sap', 'dsa', 'oops', 'system design',
];

/** lowercase, strip punctuation except . # + / (they matter in "c#", "c++", "node.js", "ci/cd"), map synonyms. */
export function normalizeSkill(skill: string): string {
  const cleaned = skill.toLowerCase().replace(/[^a-z0-9.#+/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return SKILL_SYNONYMS[cleaned] ?? SKILL_SYNONYMS[cleaned.replace(/\s/g, '')] ?? cleaned;
}

export function normalizeSkillSet(skills: string[]): Set<string> {
  return new Set(skills.map(normalizeSkill).filter(Boolean));
}
