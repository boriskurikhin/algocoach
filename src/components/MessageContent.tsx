import type { ReactNode } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-typescript';
import { MathText } from './MathText';
import './message-content.css';

interface MessageContentProps {
  content: string;
}

type MessagePart =
  { type: 'text'; value: string } | { type: 'code'; value: string; language: string };

type InlinePart =
  { type: 'text'; value: string } | { type: 'inline-code'; value: string };

const aliases: Record<string, string> = {
  'c++': 'cpp',
  cc: 'cpp',
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  rs: 'rust',
  golang: 'go',
  plaintext: 'text',
};

function parseMessage(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const fences = /```([a-zA-Z0-9_+#-]*)[ \t]*\n([\s\S]*?)```/g;
  let cursor = 0;

  for (const match of content.matchAll(fences)) {
    const index = match.index;
    if (index > cursor) {
      parts.push({ type: 'text', value: content.slice(cursor, index) });
    }
    const rawLanguage = (match[1] || 'text').toLowerCase();
    parts.push({
      type: 'code',
      language: Object.hasOwn(aliases, rawLanguage)
        ? aliases[rawLanguage]!
        : rawLanguage,
      value: (match[2] ?? '').replace(/\n$/, ''),
    });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ type: 'text', value: content.slice(cursor) });
  }
  return parts.length ? parts : [{ type: 'text', value: content }];
}

function parseInlineCode(content: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const spans = /(?<![\\`])`([^`\n]+)`(?!`)/g;
  let cursor = 0;

  for (const match of content.matchAll(spans)) {
    const index = match.index;
    if (index > cursor) {
      parts.push({ type: 'text', value: content.slice(cursor, index) });
    }
    parts.push({ type: 'inline-code', value: match[1] ?? '' });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ type: 'text', value: content.slice(cursor) });
  }
  return parts.length ? parts : [{ type: 'text', value: content }];
}

function renderTokens(stream: Prism.TokenStream, key: string): ReactNode {
  if (typeof stream === 'string') return stream;
  if (Array.isArray(stream)) {
    return stream.map((token, index) => renderTokens(token, `${key}-${index}`));
  }

  const tokenAliases = Array.isArray(stream.alias)
    ? stream.alias
    : stream.alias
      ? [stream.alias]
      : [];
  return (
    <span className={['token', stream.type, ...tokenAliases].join(' ')} key={key}>
      {renderTokens(stream.content, `${key}-content`)}
    </span>
  );
}

function CodeSnippet({ value, language }: { value: string; language: string }) {
  const grammar = Object.hasOwn(Prism.languages, language)
    ? Prism.languages[language]
    : undefined;
  const tokens = grammar ? Prism.tokenize(value, grammar) : value;

  return (
    <figure className="code-snippet">
      <figcaption>{grammar ? language : 'text'}</figcaption>
      <pre>
        <code className={`language-${grammar ? language : 'text'}`}>
          {renderTokens(tokens, 'token')}
        </code>
      </pre>
    </figure>
  );
}

function Prose({ value, partIndex }: { value: string; partIndex: number }) {
  return parseInlineCode(value).map((part, index) =>
    part.type === 'inline-code' ? (
      <code className="inline-code" key={`inline-code-${partIndex}-${index}`}>
        {part.value}
      </code>
    ) : (
      <MathText
        className="message-prose"
        key={`prose-${partIndex}-${index}`}
        value={part.value}
      />
    ),
  );
}

export function MessageContent({ content }: MessageContentProps) {
  return (
    <div className="message-content">
      {parseMessage(content).map((part, index) =>
        part.type === 'code' ? (
          <CodeSnippet
            key={`code-${index}`}
            value={part.value}
            language={part.language}
          />
        ) : (
          <Prose key={`text-${index}`} partIndex={index} value={part.value} />
        ),
      )}
    </div>
  );
}
