import type { ProblemSite } from '../schema';

export interface ProblemAdapterConfig {
  site: ProblemSite;
  hosts: string[];
  pathPattern?: string;
  titleSelectors: string[];
  statementSelectors: string[];
  inputSelectors: string[];
  outputSelectors: string[];
  constraintsSelectors: string[];
  sampleInputSelectors: string[];
  sampleOutputSelectors: string[];
  explanationSelectors: string[];
  timeLimitSelectors: string[];
  memoryLimitSelectors: string[];
  ratingSelectors: string[];
  tagSelectors: string[];
  removeSelectors: string[];
  baseConfidence: number;
}
