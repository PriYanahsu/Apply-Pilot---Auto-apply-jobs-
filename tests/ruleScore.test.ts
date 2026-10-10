/**
 * FILE: tests/ruleScore.test.ts
 * WHAT: Skill normalization, overlap, title similarity and the final score formula.
 */
import { describe, expect, it } from 'vitest';
import { computeFinalScore, computeRuleScore, skillOverlap, titleSimilarity } from '../src/matching/ruleScore';
import { normalizeSkill } from '../src/matching/skillSynonyms';

describe('normalizeSkill', () => {
  it.each([['ReactJS', 'react'], ['React.js', 'react'], ['JS', 'javascript'], ['K8s', 'kubernetes'], ['NodeJS', 'node.js'], ['C#', 'c#'], ['  Python  ', 'python']])('%s -> %s', (input, expected) => {
    expect(normalizeSkill(input)).toBe(expected);
  });
});

describe('skillOverlap', () => {
  it('counts synonyms as the same skill', () => {
    expect(skillOverlap(['ReactJS', 'JS', 'Redux', 'GraphQL'], ['react', 'javascript', 'redux'])).toBe(0.75);
  });
  it('is 0 for no job skills', () => {
    expect(skillOverlap([], ['react'])).toBe(0);
  });
});

describe('titleSimilarity', () => {
  it('ignores seniority words', () => {
    expect(titleSimilarity('Senior React Developer', ['React Developer'])).toBe(1);
  });
  it('takes the best target title', () => {
    expect(titleSimilarity('Frontend Engineer', ['Backend Developer', 'Frontend Engineer'])).toBe(1);
    expect(titleSimilarity('Sales Executive', ['Frontend Engineer'])).toBe(0);
  });
});

describe('scores', () => {
  it('ruleScore = 55*overlap + 25*title + 20*experience fit', () => {
    expect(computeRuleScore(['react', 'redux'], 'React Developer', ['react', 'redux'], ['React Developer'], 1)).toBe(100);
    expect(computeRuleScore(['react', 'java'], 'Java Developer', ['react'], ['Frontend Engineer'], 0.5)).toBe(38);
  });
  it('without an experience range, skills and title share the full 100', () => {
    expect(computeRuleScore(['react', 'redux'], 'React Developer', ['react', 'redux'], ['React Developer'])).toBe(100);
    expect(computeRuleScore(['react', 'java'], 'Java Developer', ['react'], ['Frontend Engineer'])).toBe(34);
  });
  it('finalScore = 0.35 rule + 0.65 ai, capped at 40 on deal-breaker', () => {
    expect(computeFinalScore(80, 90, false, 0.35, 0.65, 40)).toBe(87);
    expect(computeFinalScore(80, 90, true, 0.35, 0.65, 40)).toBe(40);
  });
});
