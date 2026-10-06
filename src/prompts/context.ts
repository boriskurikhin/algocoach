import type { ResponseInput } from 'openai/resources/responses/responses';
import type { ChatMessage } from '../agent/schemas';
import type { ProblemContext } from '../extraction/schema';

const MAX_PROMPT_MESSAGES = 24;

type PromptMessage = Pick<ChatMessage, 'role' | 'content' | 'visualization'>;

export function delimited(name: string, value: unknown): string {
  return `${name}_START\n${JSON.stringify(value) ?? 'null'}\n${name}_END`;
}

/** Keep stable data cacheable without promoting it to trusted instructions. */
export function cachedContextInput(stable: string, current: string): ResponseInput {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: stable,
          prompt_cache_breakpoint: { mode: 'explicit' },
        },
        { type: 'input_text', text: current },
      ],
    },
  ];
}

export function problemForPrompt(problem: ProblemContext) {
  return {
    title: problem.title,
    statement: problem.statement,
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
  };
}

export function recentConversationForPrompt(
  messages: readonly PromptMessage[],
  maxChars: number,
): { messages: PromptMessage[]; omittedMessages: number } {
  const latestAssistant = messages.findLastIndex(({ role }) => role === 'assistant');
  const compact = messages.map(({ role, content, visualization }, index) => ({
    role,
    content,
    ...(index === latestAssistant && visualization ? { visualization } : {}),
  }));
  let remaining = maxChars;
  let start = compact.length;
  while (start > 0 && compact.length - start < MAX_PROMPT_MESSAGES) {
    const size = JSON.stringify(compact[start - 1]).length;
    // Always retain the latest message intact, including escaped code or a visual.
    if (start < compact.length && size > remaining) break;
    remaining -= size;
    start -= 1;
  }

  const selected = compact.slice(start);
  const firstLearner = compact.findIndex(({ role }) => role === 'user');
  const opening = compact[firstLearner];
  if (opening && firstLearner < start && JSON.stringify(opening).length <= remaining) {
    selected.unshift(opening);
  }
  return { messages: selected, omittedMessages: messages.length - selected.length };
}
