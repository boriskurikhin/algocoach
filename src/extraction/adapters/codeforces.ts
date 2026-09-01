import type { ProblemAdapterConfig } from './types';

export const codeforcesAdapter: ProblemAdapterConfig = {
  site: 'codeforces',
  hosts: ['codeforces.com', 'www.codeforces.com'],
  pathPattern:
    '^/(?:contest/\\d+/problem|problemset/problem/\\d+|gym/\\d+/problem)/[^/?]+/?(?:\\?|$)',
  titleSelectors: ['.problem-statement .header .title'],
  statementSelectors: ['.problem-statement'],
  inputSelectors: ['.problem-statement .input-specification'],
  outputSelectors: ['.problem-statement .output-specification'],
  constraintsSelectors: [],
  sampleInputSelectors: ['.sample-tests .input pre'],
  sampleOutputSelectors: ['.sample-tests .output pre'],
  explanationSelectors: ['.problem-statement .note'],
  timeLimitSelectors: ['.problem-statement .time-limit'],
  memoryLimitSelectors: ['.problem-statement .memory-limit'],
  ratingSelectors: ['.tag-box[title^="Difficulty"]'],
  tagSelectors: ['.roundbox.sidebox .tag-box'],
  removeSelectors: [
    '.header .input-file',
    '.header .output-file',
    '.input-output-copier',
  ],
  baseConfidence: 0.94,
};
