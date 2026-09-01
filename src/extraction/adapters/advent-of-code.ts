import type { ProblemAdapterConfig } from './types';

export const adventOfCodeAdapter: ProblemAdapterConfig = {
  site: 'advent-of-code',
  hosts: ['adventofcode.com', 'www.adventofcode.com'],
  pathPattern: '^/\\d{4}/day/\\d+/?(?:\\?|$)',
  titleSelectors: ['article.day-desc h2'],
  statementSelectors: ['article.day-desc'],
  inputSelectors: [],
  outputSelectors: [],
  constraintsSelectors: [],
  sampleInputSelectors: ['article.day-desc pre'],
  sampleOutputSelectors: [],
  explanationSelectors: [],
  timeLimitSelectors: [],
  memoryLimitSelectors: [],
  ratingSelectors: [],
  tagSelectors: [],
  removeSelectors: [],
  baseConfidence: 0.92,
};
