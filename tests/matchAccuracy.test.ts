/**
 * FILE: tests/matchAccuracy.test.ts
 * WHAT: The accuracy upgrades: per-skill years from work history, skills read from a job description,
 *       experience fit, your profile corrections, and "missing skills" you actually have.
 */
import { describe, expect, it } from 'vitest';
import { applyProfileEdits } from '../src/db/database';
import type { CandidateProfile } from '../src/db/types';
import { answerFromRules } from '../src/matching/answerRules';
import { experienceFit, jobSkillsFor, skillsInText } from '../src/matching/ruleScore';
import { fillSkillYears, yearsBySkill } from '../src/matching/workHistory';
import { reallyMissing } from '../src/steps/6-scoreJobs';

const NOW = new Date(2026, 9, 10); // Oct 2026

describe('work history -> per-skill years', () => {
  const history = [
    { title: 'Frontend Developer', company: 'B', start: '2024-01', end: 'present', skills: ['React', 'TypeScript'] },
    { title: 'Web Developer', company: 'A', start: '2022-01', end: '2023-12', skills: ['ReactJS', 'jQuery'] },
    { title: 'Freelance', company: 'C', start: '2023-06', end: '2023-12', skills: ['React'] }, // overlaps A: counted once
  ];
  it('adds up the jobs where a skill was used, overlaps once', () => {
    const years = yearsBySkill(history, NOW);
    expect(years.get('react')).toBe(5);       // Jan 2022 .. Oct 2026 = 58 months -> 5
    expect(years.get('typescript')).toBe(3);  // Jan 2024 .. Oct 2026 = 34 months -> 3
    expect(years.get('jquery')).toBe(2);
  });
  it('keeps years the resume states and fills only the missing ones', () => {
    const skills = fillSkillYears([{ name: 'React', years: 4, source: 'resume' }, { name: 'jQuery', source: 'naukri' }, { name: 'Go', source: 'resume' }], history, NOW);
    expect(skills.map((skill) => skill.years)).toEqual([4, 2, undefined]);
  });
});

describe('skills from a job description (jobs without skill tags)', () => {
  it('finds common skills and their spellings, ignores everyday words', () => {
    const found = skillsInText('We need ReactJS and Node js. Go live fast, the rest of the team uses Postgres and AWS.', ['React']);
    expect(found).toEqual(expect.arrayContaining(['react', 'node.js', 'postgresql', 'aws']));
    expect(found).not.toContain('go');
    expect(found).not.toContain('rest');
  });
  it('uses tags when the job has them', () => {
    expect(jobSkillsFor({ skills: ['Java'], description: 'React' }, [])).toEqual(['Java']);
  });
});

describe('experience fit', () => {
  it('1 inside the range, lower the further outside, undefined when not stated', () => {
    expect(experienceFit(3, '2-5 Yrs')).toBe(1);
    expect(experienceFit(1, '3-5 Yrs')).toBe(0.5);
    expect(experienceFit(10, '3-5 Yrs')).toBe(0);
    expect(experienceFit(3, '')).toBeUndefined();
  });
});

const profile = {
  skills: [{ name: 'React', years: 3, source: 'resume' }, { name: 'PHP', source: 'naukri' }, { name: 'Go', years: 2, source: 'resume' }],
  targetTitles: ['Frontend Developer'],
  resumeText: 'Built dashboards with Redux Toolkit and Tailwind CSS.',
} as unknown as CandidateProfile;

describe('your profile corrections', () => {
  it('removes, adds and replaces target roles', () => {
    const edited = applyProfileEdits(profile, { removedSkills: ['php'], addedSkills: ['Next.js', 'reactjs'], targetTitles: ['React Developer'] });
    expect(edited.skills.map((skill) => skill.name)).toEqual(['React', 'Go', 'Next.js']);
    expect(edited.targetTitles).toEqual(['React Developer']);
  });
  it('keeps the AI target roles when you set none', () => {
    expect(applyProfileEdits(profile, { removedSkills: [], addedSkills: [] }).targetTitles).toEqual(['Frontend Developer']);
  });
});

describe('missing skills you actually have are dropped', () => {
  it('drops synonyms of your skills and skills named in your resume', () => {
    expect(reallyMissing(['ReactJS', 'Tailwind CSS', 'GraphQL'], profile)).toEqual(['GraphQL']);
  });
});

describe('screening rules', () => {
  const facts = { totalExperienceYears: 4 };
  it('a yes/no experience question is not answered with a number', () => {
    expect(answerFromRules('Do you have experience in React?', [], facts, profile)).toBeNull();
  });
  it('"Go" does not match inside "good"', () => {
    expect(answerFromRules('How many years of good experience in testing do you have?', [], facts, profile)).toBeNull();
  });
  it('still answers years for a skill written another way', () => {
    expect(answerFromRules('How many years of experience in React.js?', [], facts, profile)).toBe('3');
    expect(answerFromRules('Years of experience in Golang?', [], facts, profile)).toBe('2');
  });
});
