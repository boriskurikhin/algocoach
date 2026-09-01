import {
  KnowledgeLevelSchema,
  LearnerProfileSchema,
  LearnerSnapshotSchema,
  MAX_EVIDENCE,
  ProfileObservationSchema,
  SNAPSHOT_CAVEAT,
  type KnowledgeEstimate,
  type KnowledgeLevel,
  type LearnerProfile,
  type LearnerSnapshot,
  type ProfileEvidence,
  type ProfileObservation,
  type TendencyEstimate,
} from './schema';

const forbiddenLabelPattern =
  /\b(?:lazy|smart|stupid|intelligent|unintelligent|personality|iq|depressed|anxious|adhd|autistic)\b/i;

const rankedLevels = KnowledgeLevelSchema.options;

const knowledgeFields = {
  language: 'languages',
  concept: 'concepts',
  competency: 'competencies',
} as const;

const correctionDimensions = {
  languages: 'language',
  concepts: 'concept',
  competencies: 'competency',
} as const;

const rankOf = (level: KnowledgeLevel): number => rankedLevels.indexOf(level);

export function createEmptyLearnerProfile(now = Date.now()): LearnerProfile {
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    personalizationEnabled: true,
    languages: {},
    concepts: {},
    competencies: {},
    blockers: {},
    coachingPreferences: {},
  };
}

function evidenceConfidence(observation: ProfileObservation): number {
  const cap = {
    'self-reported': 0.55,
    observed: 0.72,
    demonstrated: 0.96,
  }[observation.evidenceType];
  return Math.min(cap, observation.confidence);
}

function appendEvidence(
  previous: ProfileEvidence[],
  observation: ProfileObservation,
  now: number,
  id: string,
): ProfileEvidence[] {
  return [
    ...previous,
    {
      id,
      at: now,
      type: observation.evidenceType,
      note: observation.note,
      ...(observation.problemKey ? { problemKey: observation.problemKey } : {}),
      supports: observation.supports,
    },
  ].slice(-MAX_EVIDENCE);
}

function updateKnowledge(
  current: KnowledgeEstimate | undefined,
  observation: ProfileObservation,
  now: number,
  id: string,
): KnowledgeEstimate {
  const previous: KnowledgeEstimate = current ?? {
    level: 'unknown',
    confidence: 0,
    sampleCount: 0,
    demonstratedCount: 0,
    lastObservedAt: now,
    pinned: false,
    evidence: [],
  };
  const confidence = evidenceConfidence(observation);
  const demonstratedCount =
    previous.demonstratedCount +
    (observation.supports && observation.evidenceType === 'demonstrated' ? 1 : 0);
  const requestedLevel =
    observation.knowledgeLevel ??
    (observation.evidenceType === 'demonstrated' ? 'practicing' : 'encountered');

  let nextRank = rankOf(previous.level);
  if (!previous.pinned && observation.supports) {
    nextRank = Math.max(nextRank, rankOf(requestedLevel));
    if (nextRank === rankOf('reliable') && demonstratedCount < 2) {
      nextRank = rankOf('practicing');
    }
  } else if (!previous.pinned && !observation.supports) {
    const recentChallenges = previous.evidence.filter(
      (item) => !item.supports && now - item.at < 1000 * 60 * 60 * 24 * 120,
    ).length;
    if (recentChallenges >= 1 && confidence >= 0.55) {
      nextRank = Math.max(0, nextRank - 1);
    }
  }

  const nextConfidence = observation.supports
    ? 1 - (1 - previous.confidence) * (1 - confidence * 0.42)
    : previous.confidence * (1 - confidence * 0.28);

  return {
    ...previous,
    level: rankedLevels[nextRank] ?? 'unknown',
    confidence: Math.max(0, Math.min(0.99, nextConfidence)),
    sampleCount: previous.sampleCount + 1,
    demonstratedCount,
    lastObservedAt: now,
    evidence: appendEvidence(previous.evidence, observation, now, id),
  };
}

function updateTendency(
  current: TendencyEstimate | undefined,
  observation: ProfileObservation,
  now: number,
  id: string,
): TendencyEstimate {
  const previous: TendencyEstimate = current ?? {
    score: 0,
    confidence: 0,
    sampleCount: 0,
    lastObservedAt: now,
    pinned: false,
    evidence: [],
  };
  const confidence = evidenceConfidence(observation);
  const weight = Math.min(0.45, 0.12 + confidence * 0.33);
  const score = previous.pinned
    ? previous.score
    : previous.score * (1 - weight) + (observation.supports ? 1 : -1) * weight;

  return {
    ...previous,
    score: Math.max(-1, Math.min(1, score)),
    confidence: Math.min(0.99, 1 - (1 - previous.confidence) * (1 - confidence * 0.35)),
    sampleCount: previous.sampleCount + 1,
    lastObservedAt: now,
    evidence: appendEvidence(previous.evidence, observation, now, id),
  };
}

export function applyKnowledgeCorrection(
  profileInput: LearnerProfile,
  correction: {
    dimension: keyof typeof correctionDimensions;
    key: string;
    level: KnowledgeLevel;
    pinned: boolean;
  },
  now = Date.now(),
): LearnerProfile {
  const profile = structuredClone(LearnerProfileSchema.parse(profileInput));
  const key = correction.key.trim().toLowerCase();
  const previous = profile[correction.dimension][key];
  const observation: ProfileObservation = {
    dimension: correctionDimensions[correction.dimension],
    key,
    evidenceType: 'self-reported',
    note: 'The learner corrected this estimate in Settings.',
    supports: true,
    confidence: 1,
    knowledgeLevel: correction.level,
    problemKey: null,
  };
  profile[correction.dimension][key] = {
    level: correction.level,
    confidence: 1,
    sampleCount: Math.max(1, previous?.sampleCount ?? 0),
    demonstratedCount: previous?.demonstratedCount ?? 0,
    lastObservedAt: now,
    pinned: correction.pinned,
    evidence: appendEvidence(
      previous?.evidence ?? [],
      observation,
      now,
      `${now}-learner-correction`.slice(0, 100),
    ),
  };
  profile.updatedAt = now;
  return LearnerProfileSchema.parse(profile);
}

export function applyProfileObservations(
  profileInput: LearnerProfile,
  observationsInput: ProfileObservation[],
  now = Date.now(),
): LearnerProfile {
  const profile = structuredClone(LearnerProfileSchema.parse(profileInput));
  if (!profile.personalizationEnabled) return profile;

  observationsInput.forEach((rawObservation, index) => {
    const parsed = ProfileObservationSchema.safeParse(rawObservation);
    if (!parsed.success) return;
    const observation = { ...parsed.data, key: parsed.data.key.toLowerCase() };
    if (forbiddenLabelPattern.test(`${observation.key} ${observation.note}`)) {
      return;
    }

    const { dimension, key } = observation;
    const id = `${now}-${index}-${dimension}-${key}`.slice(0, 100);
    if (dimension === 'blocker' || dimension === 'coaching-preference') {
      const field = dimension === 'blocker' ? 'blockers' : 'coachingPreferences';
      profile[field][key] = updateTendency(profile[field][key], observation, now, id);
    } else {
      const field = knowledgeFields[dimension];
      profile[field][key] = updateKnowledge(profile[field][key], observation, now, id);
    }
  });

  profile.updatedAt = now;
  return LearnerProfileSchema.parse(profile);
}

function effectiveConfidence(
  estimate: KnowledgeEstimate | TendencyEstimate,
  now: number,
): number {
  if (estimate.pinned) return estimate.confidence;
  const ageInDays = Math.max(0, now - estimate.lastObservedAt) / 86_400_000;
  return estimate.confidence * Math.exp(-ageInDays / 240);
}

export function buildLearnerSnapshot(
  profileInput: LearnerProfile,
  relevantTerms: string[] = [],
  now = Date.now(),
): LearnerSnapshot {
  const profile = LearnerProfileSchema.parse(profileInput);
  if (!profile.personalizationEnabled) {
    return LearnerSnapshotSchema.parse({
      preferredLanguages: [],
      reliableConcepts: [],
      practicingConcepts: [],
      strengths: [],
      recurringBlockers: [],
      helpfulCoachingStyles: [],
      coachingPressure: 'standard',
      caveat: SNAPSHOT_CAVEAT,
    });
  }

  const terms = relevantTerms.map((term) => term.toLowerCase());
  const relevance = (key: string): number =>
    terms.some((term) => term.includes(key) || key.includes(term)) ? 1 : 0;

  /** Relevant entries first, then the estimates we are most confident about. */
  const rank = <T extends KnowledgeEstimate | TendencyEstimate>(
    collection: Record<string, T>,
    limit: number,
    keep: (estimate: T) => boolean,
  ): string[] =>
    Object.entries(collection)
      .filter(([, estimate]) => keep(estimate))
      .sort(
        ([leftKey, left], [rightKey, right]) =>
          relevance(rightKey) - relevance(leftKey) ||
          effectiveConfidence(right, now) - effectiveConfidence(left, now),
      )
      .slice(0, limit)
      .map(([key]) => key);

  const recurringBlockers = rank(
    profile.blockers,
    12,
    (estimate) =>
      estimate.score >= 0.28 &&
      estimate.sampleCount >= 2 &&
      effectiveConfidence(estimate, now) >= 0.35,
  );
  const firmSignals = recurringBlockers.some((key) =>
    /hint before attempt|skips? (?:trace|step)|avoids? explanation/.test(key),
  );

  return LearnerSnapshotSchema.parse({
    preferredLanguages: rank(
      profile.languages,
      5,
      (estimate) =>
        estimate.level !== 'unknown' && effectiveConfidence(estimate, now) >= 0.25,
    ),
    reliableConcepts: rank(
      profile.concepts,
      20,
      (estimate) =>
        estimate.level === 'reliable' && effectiveConfidence(estimate, now) >= 0.25,
    ),
    practicingConcepts: rank(
      profile.concepts,
      20,
      (estimate) =>
        ['encountered', 'practicing'].includes(estimate.level) &&
        effectiveConfidence(estimate, now) >= 0.25,
    ),
    strengths: rank(
      profile.competencies,
      12,
      (estimate) =>
        ['practicing', 'reliable'].includes(estimate.level) &&
        effectiveConfidence(estimate, now) >= 0.4,
    ),
    recurringBlockers,
    helpfulCoachingStyles: rank(
      profile.coachingPreferences,
      8,
      (estimate) => estimate.score >= 0.2 && effectiveConfidence(estimate, now) >= 0.3,
    ),
    coachingPressure: firmSignals ? 'firm' : 'standard',
    caveat: SNAPSHOT_CAVEAT,
  });
}
