import type { ProblemContext } from '../extraction/schema';

const MAX_PROMPT_STATEMENT_CHARS = 40_000;

/**
 * Fences one region of prompt input so the model can tell trusted instructions
 * from untrusted page text, learner text, and the private answer key.
 */
export function delimited(name: string, value: unknown): string {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return `${name}_START\n${body}\n${name}_END`;
}

export function problemForPrompt(problem: ProblemContext) {
  const statement =
    problem.statement.length <= MAX_PROMPT_STATEMENT_CHARS
      ? problem.statement
      : `${problem.statement.slice(0, 32_000)}\n[...middle omitted...]\n${problem.statement.slice(-8_000)}`;

  return {
    source: { url: problem.source.url, site: problem.source.site },
    title: problem.title,
    statement,
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
    rating: problem.rating,
    tags: problem.tags,
  };
}
