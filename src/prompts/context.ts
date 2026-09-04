import type { ChatMessage } from '../agent/schemas';
import type { ProblemContext } from '../extraction/schema';

const MAX_PROMPT_STATEMENT_CHARS = 40_000;
const MAX_PROMPT_MESSAGES = 24;

type PromptMessage = Pick<ChatMessage, 'role' | 'content'>;

/**
 * Fences one region of prompt input so the model can tell trusted instructions
 * from untrusted page text, learner text, and the private answer key.
 */
export function delimited(name: string, value: unknown): string {
  return `${name}_START\n${JSON.stringify(value) ?? 'null'}\n${name}_END`;
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
    siteDifficulty: problem.rating,
    officialCodeforcesRating:
      problem.codeforcesRating?.source === 'official'
        ? problem.codeforcesRating.value
        : undefined,
    tags: problem.tags,
  };
}

export function recentConversationForPrompt(
  messages: readonly PromptMessage[],
  maxChars: number,
): PromptMessage[] {
  let remaining = maxChars;
  return messages
    .slice(-MAX_PROMPT_MESSAGES)
    .reverse()
    .map(({ role, content }) => {
      const kept = content.slice(0, Math.max(0, remaining));
      remaining -= kept.length;
      return { role, content: kept };
    })
    .filter(({ content }) => content)
    .reverse();
}
