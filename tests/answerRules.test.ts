/**
 * FILE: tests/answerRules.test.ts
 * WHAT: Screening answers from memory and rules - and refusing to guess (acceptance #5).
 */
import { describe, expect, it } from 'vitest';
import { answerFromRules, findSavedAnswer, normalizeQuestion } from '../src/matching/answerRules';
import type { CandidateProfile, Facts, SavedAnswer } from '../src/db/types';

const facts: Facts = {
  fullName: 'Test User', phone: '9999999999', currentLocation: 'Pune', totalExperienceYears: 4,
  currentCtcLpa: 12, expectedCtcLpa: 18, noticePeriodDays: 30, willingToRelocate: true, notes: '',
};
const profile = { skills: [{ name: 'React', years: 3, source: 'both' }, { name: 'Node.js', source: 'resume' }] } as unknown as CandidateProfile;

describe('answerFromRules', () => {
  it('answers common questions', () => {
    expect(answerFromRules('What is your expected CTC (in LPA)?', [], facts, profile)).toBe('18');
    expect(answerFromRules('Current CTC?', [], facts, profile)).toBe('12');
    expect(answerFromRules('What is your notice period in days?', [], facts, profile)).toBe('30');
    expect(answerFromRules('Notice period (months)?', [], facts, profile)).toBe('1');
    expect(answerFromRules('Are you willing to relocate?', ['Yes', 'No'], facts, profile)).toBe('Yes');
    expect(answerFromRules('How many years of experience do you have in ReactJS?', [], facts, profile)).toBe('3');
    expect(answerFromRules('Total years of experience?', [], facts, profile)).toBe('4');
  });
  it('returns null instead of guessing', () => {
    expect(answerFromRules('Years of experience in Node.js?', [], facts, profile)).toBeNull(); // no per-skill years
    expect(answerFromRules('Do you have a valid passport?', ['Yes', 'No'], facts, profile)).toBeNull();
    expect(answerFromRules('Expected salary per month in INR?', [], facts, profile)).toBeNull();
    expect(answerFromRules('Are you willing to relocate?', ['Sure', 'Not now'], facts, profile)).toBeNull(); // not an option
  });
});

describe('findSavedAnswer', () => {
  const saved: SavedAnswer[] = [{ qKey: normalizeQuestion('Do you have a valid passport?'), question: 'Do you have a valid passport?', answer: 'Yes', source: 'user', updatedAt: '' }];
  it('finds exact and near-identical questions', () => {
    expect(findSavedAnswer('Do you have a valid passport ?', saved)?.answer).toBe('Yes');
    expect(findSavedAnswer('Do you currently have a valid passport?', saved)?.answer).toBe('Yes'); // Jaccard 6/7 = 0.86
    expect(findSavedAnswer('do you have valid passport', saved)).toBeNull(); // 5/6 = 0.83 < 0.85
  });
  it('does not match different questions', () => {
    expect(findSavedAnswer('Do you have a driving licence?', saved)).toBeNull();
  });
});

describe('preference questions (autoAnswerPreferences)', () => {
  const unknownFacts: Facts = {};
  it('answers willingness questions with Yes when allowed', () => {
    expect(answerFromRules('Are you willing to relocate to Bangalore?', ['Yes', 'No'], unknownFacts, profile, true)).toBe('Yes');
    expect(answerFromRules('Are you comfortable working in night shifts?', [], unknownFacts, profile, true)).toBe('Yes');
    expect(answerFromRules('Are you okay to work from office 5 days a week?', ['Yes', 'No'], unknownFacts, profile, true)).toBe('Yes');
  });
  it('respects a stated fact over the default', () => {
    expect(answerFromRules('Are you willing to relocate?', ['Yes', 'No'], { willingToRelocate: false }, profile, true)).toBe('No');
  });
  it('does nothing when switched off, or when Yes is not an option', () => {
    expect(answerFromRules('Are you comfortable with night shifts?', [], unknownFacts, profile, false)).toBeNull();
    expect(answerFromRules('Are you comfortable with night shifts?', ['Sure', 'Not really'], unknownFacts, profile, true)).toBeNull();
  });
  it('never guesses facts', () => {
    expect(answerFromRules('What is your current CTC?', [], unknownFacts, profile, true)).toBeNull();
    expect(answerFromRules('What is your notice period?', [], unknownFacts, profile, true)).toBeNull();
  });
});

describe('chatbot closing messages are not questions', () => {
  it('recognises Naukri goodbye messages (from a live run: answering this got the application refused, code 406)', async () => {
    const { isClosingMessage } = await import('../src/steps/8-answerScreening');
    expect(isClosingMessage('Thank you for your responses.')).toBe(true);
    expect(isClosingMessage('Thanks for answering all the questions! All the best.')).toBe(true);
    expect(isClosingMessage('Thank you for your response. Your application has been shared with the recruiter.')).toBe(true);
  });
  it('real questions are still answered', async () => {
    const { isClosingMessage } = await import('../src/steps/8-answerScreening');
    expect(isClosingMessage('Which of the following concepts are you familiar with?')).toBe(false);
    expect(isClosingMessage('Thank you for applying. What is your current CTC?')).toBe(false);
    expect(isClosingMessage('Please mention your notice period')).toBe(false);
  });
});

describe('chatbot intro messages are not questions', () => {
  it('skips the greeting from the live run', async () => {
    const { isIntroMessage } = await import('../src/steps/8-answerScreening');
    expect(isIntroMessage("Hi Priyanshu Kumar, thank you for showing interest. Kindly answer all the recruiter's questions to successfully apply for the job.")).toBe(true);
    expect(isIntroMessage('Kindly answer all questions. What is your notice period?')).toBe(false);
    expect(isIntroMessage('Which of the following concepts are you familiar with?')).toBe(false);
  });
});

describe('shortenAnswer (typed answers stay short)', () => {
  it('keeps short answers and cuts long ones at a word', async () => {
    const { shortenAnswer } = await import('../src/steps/8-answerScreening');
    expect(shortenAnswer('OOPs, DSA, Git, DBMS/SQL, Software Testing')).toBe('OOPs, DSA, Git, DBMS/SQL, Software Testing');
    const long = 'I am proficient in OOPs, Data Structures & Algorithms (450+ problems solved), Git/Version Control, DBMS/SQL (PostgreSQL/MySQL), and Software Testing (JUnit, Mockito, Jest, Playwright).';
    const short = shortenAnswer(long);
    expect(short.length).toBeLessThanOrEqual(100);
    expect(long.startsWith(short)).toBe(true);
    expect(short.endsWith(',')).toBe(false);
  });
});

describe('needsExplanation', () => {
  it('tells explanation questions from simple ones', async () => {
    const { needsExplanation } = await import('../src/steps/8-answerScreening');
    expect(needsExplanation('Describe a project you are proud of')).toBe(true);
    expect(needsExplanation('Why should we hire you?')).toBe(true);
    expect(needsExplanation('Which of the following concepts are you familiar with?')).toBe(false);
    expect(needsExplanation('What is your notice period?')).toBe(false);
  });
});

describe('bestOptionMatch (AI answer -> the option it means)', () => {
  it('maps a number of years into range options (the live "Frontend / Backend" case)', async () => {
    const { bestOptionMatch } = await import('../src/matching/answerRules');
    const ranges = ['Fresher', '0-1 Years', '1-3 Years', 'More than 3 years'];
    expect(bestOptionMatch('1', ['Fresher', '0-1 Years', '2-3 Years'])).toBe('0-1 Years');
    expect(bestOptionMatch('2', ranges)).toBe('1-3 Years');
    expect(bestOptionMatch('5 years', ranges)).toBe('More than 3 years');
    expect(bestOptionMatch('0', ranges)).toBe('Fresher');
    expect(bestOptionMatch('1.3', ['Fresher', 'Less than 6 months', '6 12 months', 'More than 1 year'])).toBe('More than 1 year');
    expect(bestOptionMatch('0.75', ['Less than 6 months', '6-12 months', 'More than 1 year'])).toBe('6-12 months');
    expect(bestOptionMatch('0.75', ['Fresher', 'Less than 6 months', '6 12 months', 'More than 1 year'])).toBe('6 12 months');
  });
  it('handles yes/no and exact text, and refuses to guess', async () => {
    const { bestOptionMatch } = await import('../src/matching/answerRules');
    expect(bestOptionMatch('yes', ['Yes', 'No', 'Skip this question'])).toBe('Yes');
    expect(bestOptionMatch('No, I am not', ['Yes', 'No'])).toBe('No');
    expect(bestOptionMatch('IT Services', ['BPM', 'IT Services', 'Technology'])).toBe('IT Services');
    expect(bestOptionMatch('Marketing', ['BPM', 'IT Services'])).toBeNull();
  });
});
