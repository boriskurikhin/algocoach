import type { ProblemAdapterConfig } from './types';

export const dmojAdapter: ProblemAdapterConfig = {
  site: 'dmoj',
  hosts: ['dmoj.ca', 'www.dmoj.ca'],
  pathPattern: '^/problem/[^/?]+/?(?:\\?|$)',
  titleSelectors: ['.problem-title h2'],
  statementSelectors: ['.content-description.screen'],
  inputSelectors: [],
  outputSelectors: [],
  constraintsSelectors: [],
  sampleInputSelectors: [],
  sampleOutputSelectors: [],
  explanationSelectors: [],
  timeLimitSelectors: ['.problem-info-entry:has(.fa-clock-o) .pi-value'],
  memoryLimitSelectors: ['.problem-info-entry:has(.fa-server) .pi-value'],
  ratingSelectors: ['.problem-info-entry:has(.fa-check) .pi-value'],
  tagSelectors: [],
  removeSelectors: ['.copy-clipboard'],
  baseConfidence: 0.94,
};
