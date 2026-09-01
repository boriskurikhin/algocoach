import { useEffect, useRef } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';

// Judges write inline math as `$...$`, which KaTeX omits from its defaults
// because a lone dollar sign is ambiguous in ordinary prose.
const delimiters = [
  { left: '$$', right: '$$', display: true },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
  { left: '$', right: '$', display: false },
];

interface MathTextProps {
  value: string;
  className?: string;
}

/**
 * KaTeX finds the delimiters and renders them, so it owns these children
 * outright: React only ever sees an empty host and cannot fight its markup.
 * Text arrives through `textContent`, so page markup stays inert.
 */
export function MathText({ value, className }: MathTextProps) {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    node.textContent = value;
    renderMathInElement(node, { delimiters, throwOnError: false });
  }, [value]);

  return <span className={className} ref={host} />;
}
