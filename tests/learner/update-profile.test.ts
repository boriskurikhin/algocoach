import { describe, expect, it } from 'vitest';
import type { ProfileObservation } from '../../src/learner/schema';
import {
  applyKnowledgeCorrection,
  applyProfileObservations,
  buildLearnerSnapshot,
  createEmptyLearnerProfile,
} from '../../src/learner/update-profile';

const observation = (
  overrides: Partial<ProfileObservation> = {},
): ProfileObservation => ({
  dimension: 'concept',
  key: 'fft',
  evidenceType: 'demonstrated',
  note: 'Correctly explained convolution and frequency-domain multiplication.',
  supports: true,
  confidence: 0.9,
  knowledgeLevel: 'reliable',
  problemKey: 'problem-1',
  ...overrides,
});

const enabledProfile = (now: number) => ({
  ...createEmptyLearnerProfile(now),
  personalizationEnabled: true,
});

describe('learner profile updates', () => {
  it('starts without assumptions', () => {
    const profile = createEmptyLearnerProfile(100);
    expect(profile.personalizationEnabled).toBe(false);
    expect(profile.languages).toEqual({});
    expect(profile.concepts).toEqual({});
    expect(buildLearnerSnapshot(profile, [], 100)).toEqual(
      expect.objectContaining({
        preferredLanguages: [],
        reliableConcepts: [],
        coachingPressure: 'standard',
      }),
    );
  });

  it('requires repeated demonstrations before marking knowledge reliable', () => {
    const start = enabledProfile(100);
    const once = applyProfileObservations(start, [observation()], 200);
    expect(once.concepts.fft?.level).toBe('practicing');

    const twice = applyProfileObservations(once, [observation()], 300);
    expect(twice.concepts.fft?.level).toBe('reliable');
    expect(twice.concepts.fft?.demonstratedCount).toBe(2);
  });

  it('keeps self-reported knowledge distinct from demonstrated mastery', () => {
    const profile = applyProfileObservations(
      enabledProfile(100),
      [
        observation({
          dimension: 'language',
          key: 'Python',
          evidenceType: 'self-reported',
          note: 'The learner said Python is their main language.',
          confidence: 1,
        }),
      ],
      200,
    );

    expect(profile.languages.python?.confidence).toBeLessThan(0.6);
    expect(profile.languages.python?.level).toBe('practicing');
    expect(profile.languages.python?.demonstratedCount).toBe(0);
  });

  it('records explicit learner corrections as pinned self-reports', () => {
    const profile = applyKnowledgeCorrection(
      createEmptyLearnerProfile(100),
      {
        dimension: 'concepts',
        key: 'FFT',
        level: 'reliable',
        pinned: true,
      },
      200,
    );

    expect(profile.concepts.fft).toMatchObject({
      level: 'reliable',
      confidence: 1,
      sampleCount: 1,
      pinned: true,
      evidence: [
        expect.objectContaining({
          type: 'self-reported',
          note: 'The learner corrected this estimate in Settings.',
        }),
      ],
    });
  });

  it('does not turn one difficult moment into a downgrade', () => {
    const reliable = applyProfileObservations(
      applyProfileObservations(enabledProfile(100), [observation()], 200),
      [observation()],
      300,
    );
    const oneChallenge = applyProfileObservations(
      reliable,
      [
        observation({
          supports: false,
          note: 'Could not connect convolution to multiplication in this problem.',
        }),
      ],
      400,
    );
    expect(oneChallenge.concepts.fft?.level).toBe('reliable');

    const repeatedChallenge = applyProfileObservations(
      oneChallenge,
      [
        observation({
          supports: false,
          note: 'Repeatedly confused the transform direction.',
        }),
      ],
      500,
    );
    expect(repeatedChallenge.concepts.fft?.level).toBe('practicing');
  });

  it('rejects fixed moral and intelligence labels', () => {
    const profile = applyProfileObservations(
      enabledProfile(100),
      [
        observation({
          dimension: 'blocker',
          key: 'lazy',
          evidenceType: 'observed',
          note: 'Asked for a hint.',
          knowledgeLevel: null,
        }),
        observation({
          dimension: 'competency',
          key: 'intelligent',
          note: 'Solved quickly.',
        }),
        observation({
          dimension: 'blocker',
          key: 'asks early',
          evidenceType: 'observed',
          note: 'The learner is lazy.',
          knowledgeLevel: null,
        }),
      ],
      200,
    );

    expect(profile.blockers).toEqual({});
    expect(profile.competencies).toEqual({});
  });

  it('uses repeated behavior to select firm coaching without moral judgment', () => {
    const behavior = observation({
      dimension: 'blocker',
      key: 'hint before attempt',
      evidenceType: 'observed',
      note: 'Requested a stronger hint before attempting the proposed trace.',
      knowledgeLevel: null,
      confidence: 0.7,
    });
    const profile = applyProfileObservations(
      applyProfileObservations(enabledProfile(100), [behavior], 200),
      [behavior],
      300,
    );
    const snapshot = buildLearnerSnapshot(profile, [], 300);

    expect(snapshot.recurringBlockers).toContain('hint before attempt');
    expect(snapshot.coachingPressure).toBe('firm');
    expect(JSON.stringify(snapshot)).not.toContain('lazy');
  });

  it('sends a minimized snapshot rather than local evidence notes', () => {
    const profile = applyProfileObservations(
      enabledProfile(100),
      [
        observation({
          note: 'PRIVATE LOCAL EVIDENCE NOTE THAT MUST NOT LEAVE STORAGE',
        }),
      ],
      200,
    );
    const serialized = JSON.stringify(buildLearnerSnapshot(profile, ['fft'], 200));
    expect(serialized).toContain('fft');
    expect(serialized).not.toContain('PRIVATE LOCAL EVIDENCE');
    expect(serialized).not.toContain('problem-1');
  });

  it('honors disabled personalization and stale confidence', () => {
    const old = applyProfileObservations(enabledProfile(0), [observation()], 1);
    const staleSnapshot = buildLearnerSnapshot(old, [], 86_400_000 * 2_000);
    expect(staleSnapshot.reliableConcepts).toEqual([]);
    expect(staleSnapshot.practicingConcepts).toEqual([]);

    const disabled = { ...old, personalizationEnabled: false };
    const unchanged = applyProfileObservations(
      disabled,
      [observation({ key: 'segment tree' })],
      500,
    );
    expect(unchanged.concepts['segment tree']).toBeUndefined();
    expect(buildLearnerSnapshot(disabled).preferredLanguages).toEqual([]);
  });
});
