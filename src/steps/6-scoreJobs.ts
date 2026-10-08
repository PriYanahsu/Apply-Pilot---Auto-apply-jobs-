/**
 * FILE: steps/6-scoreJobs.ts
 * WHAT: Gives each enriched job a match score (0-100):
 *       ruleScore (skill overlap + title, no AI) and aiScore (Gemini P2, up to 8 jobs per call),
 *       finalScore = round(0.35*rule + 0.65*ai), capped at 40 when Gemini flags a deal-breaker.
 * CALLED BY: orchestrator/runPipeline.ts (step SCORING)
 * READS: db.jobs (status 'enriched'), db.profile
 * WRITES: ruleScore / aiScore / finalScore / matchReason / missingSkills, status -> 'scored'
 * IF IT BREAKS: Debug > AI calls (turn on debug mode) shows exactly what Gemini saw and said.
 */
import { askGemini } from '../ai/gemini';
import { jobScorerPrompt, type JobScore } from '../ai/prompts';
import {
  AI_SCORE_WEIGHT, DEAL_BREAKER_MAX_SCORE, GEMINI_SCORE_BATCH_SIZE, RULE_SCORE_WEIGHT,
} from '../config';
import { db, getProfile, updateJob } from '../db/database';
import type { CandidateProfile, Job } from '../db/types';
import { computeFinalScore, computeRuleScore } from '../matching/ruleScore';
import { handleJobError } from '../orchestrator/jobFailures';
import { bumpCounter, checkpoint } from '../orchestrator/runState';
import { makeError } from '../shared/errors';
import { log } from '../shared/log';

export async function scoreJobs(runId: number): Promise<void> {
  const profile = await getProfile();
  if (!profile) throw makeError('SETUP_MISSING', 'No profile yet. Click "Refresh profile" in the Setup tab.');
  const jobs = await db.jobs.where('status').equals('enriched').toArray();
  await log('6-score', `Scoring ${jobs.length} jobs in batches of ${GEMINI_SCORE_BATCH_SIZE}`);

  for (let start = 0; start < jobs.length; start += GEMINI_SCORE_BATCH_SIZE) {
    await checkpoint(runId);
    const batch = jobs.slice(start, start + GEMINI_SCORE_BATCH_SIZE);
    try {
      const aiScores = await askGemini(jobScorerPrompt(profile, batch));
      for (const job of batch) await saveScore(runId, job, profile, aiScores.find((score) => score.jobId === job.jobId));
    } catch (error) {
      // A bad batch (e.g. invalid JSON twice) fails only those jobs; quota errors re-throw and pause the run.
      for (const job of batch) await handleJobError(runId, job.jobId, '6-score', error);
    }
  }
}

async function saveScore(runId: number, job: Job, profile: CandidateProfile, aiScore: JobScore | undefined): Promise<void> {
  if (!aiScore) {
    await handleJobError(runId, job.jobId, '6-score', makeError('GEMINI_INVALID', 'Gemini returned no score for this job'));
    return;
  }
  const candidateSkills = profile.skills.map((skill) => skill.name);
  const ruleScore = computeRuleScore(job.skills, job.title, candidateSkills, profile.targetTitles);
  const finalScore = computeFinalScore(ruleScore, aiScore.score, aiScore.dealBreaker, RULE_SCORE_WEIGHT, AI_SCORE_WEIGHT, DEAL_BREAKER_MAX_SCORE);
  await updateJob(job.jobId, {
    ruleScore, aiScore: aiScore.score, finalScore, dealBreaker: aiScore.dealBreaker,
    matchReason: aiScore.reason, missingSkills: aiScore.missingSkills, status: 'scored',
  });
  await bumpCounter(runId, 'scored');
  await log('6-score', `Scored ${finalScore} (rule ${ruleScore}, ai ${aiScore.score}${aiScore.dealBreaker ? ', DEAL-BREAKER' : ''}): ${aiScore.reason}`, { jobId: job.jobId });
}
