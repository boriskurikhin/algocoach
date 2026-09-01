import type { CoachingMap, CoachingSession } from '../../src/agent/schemas';
import type { SessionUsage } from '../../src/agent/usage';
import type { ProblemContext } from '../../src/extraction/schema';
import type { LearnerSnapshot } from '../../src/learner/schema';
import type { RestorableSession } from '../../src/messaging/schema';
import type { DrawConcept } from '../../src/visualization/schema';

export const problemFixture: ProblemContext = {
  version: 1,
  source: {
    url: 'https://judge.example/problem/sums',
    host: 'judge.example',
    site: 'generic',
    extractedAt: 1,
  },
  title: 'Batch Sums',
  statement:
    'Given enough items and fixed-size batches, determine the total resource needed. ' +
    'The input describes each conversion and the output asks for one total. '.repeat(8),
  input: 'The first line contains N.',
  output: 'Print the required total.',
  constraints: ['1 <= N <= 100'],
  samples: [{ input: '5', output: '3' }],
  tags: ['graphs'],
  sections: [],
  confidence: 0.9,
  warnings: [],
};

export const learnerSnapshotFixture: LearnerSnapshot = {
  preferredLanguages: ['python'],
  reliableConcepts: [],
  practicingConcepts: ['breadth-first search'],
  strengths: ['tiny-example tracing'],
  recurringBlockers: [],
  helpfulCoachingStyles: ['concrete examples'],
  coachingPressure: 'standard',
  caveat: 'Estimates are uncertain and must not override current evidence.',
};

export const coachingMapFixture: CoachingMap = {
  problemSummary: 'Track fixed-size production while preserving excess output.',
  solutionFamilies: [
    {
      name: 'demand expansion',
      coreIdea: 'Expand unmet demand and retain surplus.',
      invariant: 'Demand plus retained surplus conserves produced material.',
      complexity: 'Linear in the number of conversions.',
    },
  ],
  canonicalFamily: 'demand expansion',
  edgeCases: ['Demand is already covered by surplus.'],
  likelyMisconceptions: ['Discarding production surplus.'],
  relevantConcepts: ['resource accounting'],
  hintLadder: [
    {
      stage: 'listen',
      diagnosticQuestion: 'What does each quantity represent?',
      safeNudge: 'Separate needed material from material already owned.',
    },
    {
      stage: 'clarify',
      diagnosticQuestion: 'What does one batch produce?',
      safeNudge: 'Trace a demand that is not divisible by batch size.',
    },
    {
      stage: 'concretize',
      diagnosticQuestion: 'Where does excess output go?',
      safeNudge: 'Account for every produced unit.',
    },
  ],
  visualizationOpportunities: ['Show one fixed-size batch and its unused units.'],
};

export const sessionUsageFixture: SessionUsage = {
  modelCalls: 1,
  inputTokens: 1_000,
  cachedInputTokens: 200,
  cacheWriteTokens: 100,
  outputTokens: 500,
  reasoningTokens: 350,
  estimatedCostUsd: 0.01338,
};

export const sessionFixture: CoachingSession = {
  version: 1,
  id: 'session-1',
  problemKey: problemFixture.source.url,
  problem: problemFixture,
  coachingMap: coachingMapFixture,
  stage: 'listen',
  messages: [
    {
      id: 'message-1',
      role: 'assistant',
      content: 'What are you thinking so far?',
      createdAt: 1,
    },
    {
      id: 'message-2',
      role: 'user',
      content: 'I think I need to round up each batch.',
      createdAt: 2,
    },
  ],
  usage: sessionUsageFixture,
  createdAt: 1,
  updatedAt: 2,
};

export const restorableSessionFixture: RestorableSession = {
  sessionId: sessionFixture.id,
  problem: sessionFixture.problem,
  stage: sessionFixture.stage,
  messages: sessionFixture.messages,
  usage: sessionFixture.usage,
};

export const sessionReadyFixture = {
  type: 'session:ready' as const,
  ...restorableSessionFixture,
};

export const sceneFixture: DrawConcept = {
  title: 'One batch',
  question: 'How many units remain after using five?',
  frames: [
    {
      caption: 'A batch produces six units.',
      durationMs: 500,
      primitives: [
        {
          type: 'array',
          id: 'batch',
          label: 'Produced units',
          indexStart: 1,
          values: ['1', '2', '3', '4', '5', '6'],
          highlighted: [],
          secondaryHighlighted: null,
          ranges: [{ start: 1, end: 6, label: 'one batch', state: 'normal' }],
          pointers: [],
        },
      ],
    },
    {
      caption: 'Five are used and one remains.',
      durationMs: 500,
      primitives: [
        {
          type: 'array',
          id: 'batch',
          label: 'Produced units',
          indexStart: 1,
          values: ['1', '2', '3', '4', '5', '6'],
          highlighted: [6],
          secondaryHighlighted: [1, 2, 3, 4, 5],
          ranges: [{ start: 1, end: 5, label: '5 used', state: 'secondary' }],
          pointers: [{ index: 6, label: 'left' }],
        },
      ],
    },
  ],
};
