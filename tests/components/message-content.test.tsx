import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageContent } from '../../src/components/MessageContent';

describe('message code snippets', () => {
  it('parses fenced snippets without treating prose as code', () => {
    const { container } = render(
      <MessageContent
        content={
          'The update is local:\n```python\nleftovers[item] -= used\n```\nWhat changed?'
        }
      />,
    );

    expect(container.textContent).toContain('The update is local:');
    expect(container.querySelector('code')).toHaveTextContent(
      'leftovers[item] -= used',
    );
    expect(container.textContent).toContain('What changed?');
  });

  it('renders single-backtick spans as inline code', () => {
    const { container } = render(
      <MessageContent
        content={'For `N=5`, source `j=3` can use intervals `[1,3]` and `[0,4]`.'}
      />,
    );

    expect(
      Array.from(container.querySelectorAll('code.inline-code')).map(
        (node) => node.textContent,
      ),
    ).toEqual(['N=5', 'j=3', '[1,3]', '[0,4]']);
    expect(container.textContent).not.toContain('`');
  });

  it('does not typeset dollar signs inside inline code', () => {
    const { container } = render(
      <MessageContent content={'Keep `$10` literal, but typeset $n^2$.'} />,
    );

    expect(container.querySelector('code.inline-code')).toHaveTextContent('$10');
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
  });

  it('leaves unmatched backticks as ordinary text', () => {
    const { container } = render(
      <MessageContent content={'What does the unfinished `marker mean?'} />,
    );

    expect(container.querySelector('code.inline-code')).toBeNull();
    expect(container.textContent).toContain('`marker');
  });

  it('renders local syntax tokens and keeps markup inert', () => {
    const { container } = render(
      <MessageContent
        content={
          'Tiny example:\n```python\nif remaining == 0:\n    break\n```\n' +
          '<script>window.bad = true</script>'
        }
      />,
    );

    expect(screen.getByText('python')).toBeInTheDocument();
    expect(container.querySelector('.token.keyword')).toHaveTextContent('if');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>window.bad = true</script>');
  });

  it('typesets the inline and display math judges write', () => {
    const { container } = render(
      <MessageContent
        content={'Bounded by $10^5$ cows.\n$$\\sum_{i=1}^{n} a_i$$\nSo it fits.'}
      />,
    );

    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelector('.katex-display')).not.toBeNull();
    // KaTeX keeps the source, so the exponent survives instead of reading 105.
    expect(
      Array.from(
        container.querySelectorAll('annotation[encoding="application/x-tex"]'),
      ).map((node) => node.textContent),
    ).toEqual(['10^5', '\\sum_{i=1}^{n} a_i']);
    expect(container.textContent).toContain('Bounded by');
    expect(container.textContent).toContain('So it fits.');
  });

  it('leaves dollar signs inside code snippets untouched', () => {
    const { container } = render(
      <MessageContent content={'```bash\ncost=$10\necho $x\n```'} />,
    );

    expect(container.querySelector('.katex')).toBeNull();
    expect(container.querySelector('code')).toHaveTextContent('cost=$10');
  });

  it('maps common competitive-programming language aliases', () => {
    render(<MessageContent content={'```c++\nlong long n;\n```'} />);
    expect(screen.getByText('cpp')).toBeInTheDocument();
  });

  it('treats unknown and prototype-like language labels as plain text', () => {
    render(<MessageContent content={'```__proto__\nvalue\n```'} />);
    expect(screen.getByText('text')).toBeInTheDocument();
    expect(screen.getByText('value')).toBeInTheDocument();
  });
});
