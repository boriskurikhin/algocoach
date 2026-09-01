import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DrawConceptSchema,
  isFocusedVisualization,
  type DrawConcept,
} from '../../src/visualization/schema';
import { Whiteboard } from '../../src/visualization/Whiteboard';
import { sceneFixture } from '../fixtures/domain';

describe('animated whiteboard', () => {
  it('renders one validated frame at a time with manual controls', () => {
    const { container } = render(<Whiteboard scene={sceneFixture} />);

    expect(
      screen.getByRole('img', { name: /batch produces six/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('A batch produces six units.')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(
      [...container.querySelectorAll('.visual-array-index')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['1', '2', '3', '4', '5', '6']);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Five are used and one remains.')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(container.querySelector('.visual-value.state-active')).toHaveTextContent(
      '6',
    );
    expect(container.querySelectorAll('.visual-value.state-secondary')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('keeps old stored arrays valid while enforcing focused new drawings', () => {
    const parsed = DrawConceptSchema.parse({
      title: 'Legacy array',
      question: 'What changes?',
      frames: [
        {
          caption: 'One old stored frame.',
          durationMs: 500,
          primitives: [
            {
              type: 'array',
              id: 'legacy',
              label: '',
              values: ['a', 'b'],
              highlighted: [0],
              pointers: [],
            },
          ],
        },
      ],
    });
    const primitive = parsed.frames[0]?.primitives[0];

    expect(primitive?.type).toBe('array');
    if (primitive?.type !== 'array') throw new Error('Expected an array primitive.');
    expect(primitive.indexStart).toBeNull();
    expect(primitive.secondaryHighlighted).toBeNull();
    expect(primitive.ranges).toBeNull();
    expect(isFocusedVisualization(parsed)).toBe(true);

    const crowded: DrawConcept = {
      ...sceneFixture,
      frames: Array.from({ length: 7 }, () => sceneFixture.frames[0]!),
    };
    expect(isFocusedVisualization(crowded)).toBe(false);

    const secondArray = sceneFixture.frames[1]!.primitives[0]!;
    if (secondArray.type !== 'array') throw new Error('Expected an array primitive.');
    const changedLayout: DrawConcept = {
      ...sceneFixture,
      frames: [
        sceneFixture.frames[0]!,
        {
          ...sceneFixture.frames[1]!,
          primitives: [
            {
              ...secondArray,
              values: ['1', '2', '3', '4', '5'],
              highlighted: [5],
              secondaryHighlighted: [1, 2, 3, 4],
              ranges: [{ start: 1, end: 5, label: '5 used', state: 'secondary' }],
              pointers: [{ index: 5, label: 'left' }],
            },
          ],
        },
      ],
    };
    expect(isFocusedVisualization(changedLayout)).toBe(false);
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
