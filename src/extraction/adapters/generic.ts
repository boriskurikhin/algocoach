import type { ProblemAdapterConfig } from './types';

export const genericAdapter: ProblemAdapterConfig = {
  site: 'generic',
  hosts: [],
  titleSelectors: ['main h1', 'article h1', 'h1'],
  statementSelectors: [
    '[data-problem-statement]',
    '.problem-statement',
    '#problem-statement',
    'main article',
    'main',
    'article',
    '.content',
  ],
  inputSelectors: [
    '[data-section="input"]',
    '.input-specification',
    '#input-specification',
  ],
  outputSelectors: [
    '[data-section="output"]',
    '.output-specification',
    '#output-specification',
  ],
  constraintsSelectors: ['[data-section="constraints"]', '.constraints'],
  sampleInputSelectors: [
    '.sample-input pre',
    'pre.sample-input',
    '[data-sample="input"]',
  ],
  sampleOutputSelectors: [
    '.sample-output pre',
    'pre.sample-output',
    '[data-sample="output"]',
  ],
  explanationSelectors: ['.sample-explanation', '.explanation'],
  timeLimitSelectors: ['.time-limit', '[data-label*="Time"]'],
  memoryLimitSelectors: ['.memory-limit', '[data-label*="Memory"]'],
  ratingSelectors: ['.difficulty', '.rating'],
  tagSelectors: ['.tag', '[data-topic]'],
  removeSelectors: [
    'nav',
    'header[role="banner"]',
    'footer',
    'aside',
    'form',
    'button',
  ],
  baseConfidence: 0.35,
};
