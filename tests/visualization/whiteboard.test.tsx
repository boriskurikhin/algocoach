import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DrawConceptSchema } from '../../src/visualization/schema';
import { Whiteboard } from '../../src/visualization/Whiteboard';
import { sceneFixture } from '../fixtures/domain';

describe('animated whiteboard', () => {
  it('renders one validated frame at a time with manual controls', () => {
    render(<Whiteboard scene={sceneFixture} />);

    expect(
      screen.getByRole('img', { name: /batch produces six/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('A batch produces six units.')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Five are used and one remains.')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('renders model text as inert SVG text, never executable markup', () => {
    const scene = {
      ...sceneFixture,
      title: '<script>window.bad = true</script>',
      frames: [
        {
          ...sceneFixture.frames[0]!,
          primitives: [
            {
              type: 'text' as const,
              id: 'note',
              text: '<script>window.bad = true</script>',
              state: 'normal' as const,
            },
          ],
        },
      ],
    };
    const { container } = render(<Whiteboard scene={scene} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>window.bad = true</script>');
  });

  it('rejects unknown primitives and unsafe scene sizes', () => {
    expect(
      DrawConceptSchema.safeParse({
        title: 'Bad',
        question: 'What?',
        frames: [
          {
            caption: 'Bad primitive',
            durationMs: 500,
            primitives: [{ type: 'html', html: '<iframe />' }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      DrawConceptSchema.safeParse({
        title: 'Too much',
        question: 'What?',
        frames: Array.from({ length: 13 }, () => sceneFixture.frames[0]),
      }).success,
    ).toBe(false);
  });
});
