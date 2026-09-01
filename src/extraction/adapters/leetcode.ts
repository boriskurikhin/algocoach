import type { ProblemAdapterConfig } from './types';

export const leetcodeAdapter: ProblemAdapterConfig = {
  site: 'leetcode',
  hosts: ['leetcode.com', 'www.leetcode.com', 'leetcode.cn', 'www.leetcode.cn'],
  pathPattern:
    '^/(?:problems/[^/?]+|contest/[^/?]+/problems/[^/?]+)(?:/(?:description|editorial|solutions?|submissions?|discussion))?/?(?:\\?|$)',
  titleSelectors: [
    '[data-cy="question-title"]',
    '[data-track-load="description_content"] [class*="text-title"]',
    '[class*="text-title-large"]',
  ],
  statementSelectors: [
    '[data-track-load="description_content"]',
    '[data-cy="question-content"]',
    '[class*="question-content"]',
  ],
  inputSelectors: [],
  outputSelectors: [],
  constraintsSelectors: [],
  sampleInputSelectors: [],
  sampleOutputSelectors: [],
  explanationSelectors: [],
  timeLimitSelectors: [],
  memoryLimitSelectors: [],
  ratingSelectors: ['[data-difficulty]', '[class*="text-difficulty-"]'],
  tagSelectors: ['[data-cy="topic-tag"]', 'a[href*="/tag/"]'],
  removeSelectors: [
    'button',
    '[role="tooltip"]',
    '.monaco-editor',
    '[class*="CodeMirror"]',
    '[class*="editor-container"]',
  ],
  baseConfidence: 0.92,
};
