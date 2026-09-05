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

type TextPart = { type: 'text'; value: string };
type CodePart = { type: 'code'; value: string; language: string };
type InlineCodePart = { type: 'inline-code'; value: string };
type StrongPart = { type: 'strong'; value: string };

type MessagePart = TextPart | CodePart;
type InlinePart = TextPart | InlineCodePart | StrongPart;

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

function splitDelimited<Part>(
  content: string,
  pattern: RegExp,
  toPart: (match: RegExpMatchArray) => Part,
): Array<TextPart | Part> {
  const parts: Array<TextPart | Part> = [];
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) {
      parts.push({ type: 'text', value: content.slice(cursor, index) });
    }
    parts.push(toPart(match));
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ type: 'text', value: content.slice(cursor) });
  }
  return parts.length ? parts : [{ type: 'text', value: content }];
}

function parseMessage(content: string): MessagePart[] {
  return splitDelimited<CodePart>(
    content,
    /```([a-zA-Z0-9_+#-]*)[ \t]*\n([\s\S]*?)```/g,
    (match) => {
      const rawLanguage = (match[1] || 'text').toLowerCase();
      return {
        type: 'code',
        language: Object.hasOwn(aliases, rawLanguage)
          ? aliases[rawLanguage]!
          : rawLanguage,
        value: (match[2] ?? '').replace(/\n$/, ''),
      };
    },
  );
}

function parseInlineFormatting(content: string): InlinePart[] {
  return splitDelimited<InlineCodePart | StrongPart>(
    content,
    /(?<![\\`])`([^`\n]+)`(?!`)|(?<![\\*])\*\*(?=\S)([^\n]*?\S)\*\*(?!\*)/g,
    (match) =>
      match[1] !== undefined
        ? { type: 'inline-code', value: match[1] }
        : { type: 'strong', value: match[2] ?? '' },
  );
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

function renderInlineFormatting(value: string, keyPrefix: string): ReactNode[] {
  return parseInlineFormatting(value).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.type === 'inline-code') {
      return (
        <code className="inline-code" key={`inline-code-${key}`}>
          {part.value}
        </code>
      );
    }
    if (part.type === 'strong') {
      return (
        <strong key={`strong-${key}`}>
          {renderInlineFormatting(part.value, `${key}-strong`)}
        </strong>
      );
    }
    return (
      <MathText className="message-prose" key={`prose-${key}`} value={part.value} />
    );
  });
}

function Prose({ value, partIndex }: { value: string; partIndex: number }) {
  return renderInlineFormatting(value, `${partIndex}`);
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
