import { adventOfCodeAdapter } from './adapters/advent-of-code';
import { codeforcesAdapter } from './adapters/codeforces';
import { dmojAdapter } from './adapters/dmoj';
import { genericAdapter } from './adapters/generic';
import type { ProblemAdapterConfig } from './adapters/types';
import { usacoAdapter } from './adapters/usaco';
import type { ProblemContext } from './schema';

const knownAdapters: ProblemAdapterConfig[] = [
  dmojAdapter,
  codeforcesAdapter,
  usacoAdapter,
  adventOfCodeAdapter,
];

export function adapterForUrl(url: string): ProblemAdapterConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return genericAdapter;
  }

  return (
    knownAdapters.find((adapter) => {
      const hostMatches = adapter.hosts.includes(parsed.hostname.toLowerCase());
      const pathMatches = adapter.pathPattern
        ? new RegExp(adapter.pathPattern).test(parsed.pathname + parsed.search)
        : true;
      return hostMatches && pathMatches;
    }) ?? genericAdapter
  );
}

export function isLikelyProblem(context: ProblemContext): boolean {
  return context.confidence >= 0.6 && context.statement.length >= 300;
}

export function manualProblemContext(
  statement: string,
  title = 'Pasted problem',
): ProblemContext {
  return {
    version: 1,
    source: {
      url: 'https://manual.local/problem',
      host: 'manual.local',
      site: 'generic',
      extractedAt: Date.now(),
    },
    title: title.trim().slice(0, 500) || 'Pasted problem',
    statement: statement.trim().slice(0, 120_000),
    constraints: [],
    samples: [],
    tags: [],
    sections: [],
    confidence: 1,
    warnings: ['This problem statement was pasted manually.'],
  };
}
