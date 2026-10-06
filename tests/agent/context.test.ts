import { describe, expect, it } from 'vitest';
import { recentConversationForPrompt } from '../../src/prompts/context';
import { sceneFixture } from '../fixtures/domain';

describe('conversation context', () => {
  it('retains whole recent messages rather than clipping code', () => {
    const messages = ['a', 'b', 'c'].map((letter) => ({
      role: 'user' as const,
      content: letter.repeat(100),
    }));
    expect(recentConversationForPrompt(messages, 300)).toEqual({
      messages: messages.slice(1),
      omittedMessages: 1,
    });
  });

  it('keeps the latest message even when escaping exceeds the context budget', () => {
    const latest = { role: 'user' as const, content: '"\\\n'.repeat(100) };
    expect(recentConversationForPrompt([latest], 100)).toEqual({
      messages: [latest],
      omittedMessages: 0,
    });
    expect(recentConversationForPrompt([], 100)).toEqual({
      messages: [],
      omittedMessages: 0,
    });
  });

  it('preserves the opening learner goal when it fits beside the recent tail', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      role: 'user' as const,
      content: index === 0 ? 'Help me test my proof.' : `Attempt ${index}`,
    }));
    expect(recentConversationForPrompt(messages, 5_000)).toEqual({
      messages: [messages[0], ...messages.slice(-24)],
      omittedMessages: 5,
    });
  });

  it('includes the latest assistant visual so a learner answer has context', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: 'Earlier figure.',
        visualization: sceneFixture,
      },
      { role: 'user' as const, content: 'I can account for five.' },
      {
        role: 'assistant' as const,
        content: sceneFixture.question,
        visualization: sceneFixture,
      },
      { role: 'user' as const, content: 'One remains.' },
    ];
    const context = recentConversationForPrompt(messages, 5_000);
    expect(context.messages[0]).not.toHaveProperty('visualization');
    expect(context.messages[2]?.visualization).toEqual(sceneFixture);
    expect(context.messages.at(-1)?.content).toBe('One remains.');
  });
});
