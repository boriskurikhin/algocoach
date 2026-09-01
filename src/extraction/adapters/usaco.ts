import type { ProblemAdapterConfig } from './types';

export const usacoAdapter: ProblemAdapterConfig = {
  site: 'usaco',
  hosts: ['usaco.org', 'www.usaco.org'],
  pathPattern: '^/index\\.php\\?[^#]*\\bpage=viewproblem2\\b',
  titleSelectors: ['.panel h2:nth-of-type(2)'],
  statementSelectors: ['.problem-text'],
  inputSelectors: ['.prob-in-spec'],
  outputSelectors: ['.prob-out-spec'],
  constraintsSelectors: [],
  sampleInputSelectors: ['pre.in'],
  sampleOutputSelectors: ['pre.out'],
  explanationSelectors: [],
  timeLimitSelectors: [],
  memoryLimitSelectors: [],
  ratingSelectors: [],
  tagSelectors: [],
  removeSelectors: [],
  baseConfidence: 0.86,
};
