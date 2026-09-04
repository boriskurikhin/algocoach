import type {
  CoachingMap,
  CoachingSession,
  ProblemAnalysis,
} from '../../src/agent/schemas';
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
    'Given enough items and fixed-size batches, determine the total resource needed.' +
    ' The input describes each conversion and the output asks for one total.'.repeat(8),
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
  solution: {
    name: 'demand expansion',
    coreIdea: 'Expand unmet demand and retain surplus.',
    invariant: 'Demand plus retained surplus conserves produced material.',
    complexity: 'Linear in the number of conversions.',
  },
  edgeCases: ['Demand is already covered by surplus.'],
  likelyMisconceptions: ['Discarding production surplus.'],
  relevantConcepts: ['resource accounting'],
  hintLadder: [
    {
      diagnosticQuestion: 'What does each quantity represent?',
      safeNudge: 'Separate needed material from material already owned.',
    },
    {
      diagnosticQuestion: 'What does one batch produce?',
      safeNudge: 'Trace a demand that is not divisible by batch size.',
    },
    {
      diagnosticQuestion: 'Where does excess output go?',
      safeNudge: 'Account for every produced unit.',
    },
  ],
  visualizationOpportunities: ['Show one fixed-size batch and its unused units.'],
};

export const problemAnalysisFixture: ProblemAnalysis = {
  coachingMap: coachingMapFixture,
  estimatedCodeforcesRating: 1_300,
};

export const sessionFixture: CoachingSession = {
  version: 2,
  id: 'session-1',
  problemKey: problemFixture.source.url,
  problem: {
    ...problemFixture,
    codeforcesRating: {
      value: problemAnalysisFixture.estimatedCodeforcesRating,
      source: 'estimated',
    },
  },
  coachingMap: coachingMapFixture,
  completed: false,
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
  createdAt: 1,
  updatedAt: 2,
};

export const restorableSessionFixture: RestorableSession = {
  sessionId: sessionFixture.id,
  problem: sessionFixture.problem,
  completed: sessionFixture.completed,
  messages: sessionFixture.messages,
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
