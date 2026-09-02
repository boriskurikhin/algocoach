import type { ProblemContext } from './schema';
import type { ProblemAdapterConfig } from './adapters/types';

/**
 * This function is serialized by chrome.scripting.executeScript. Keep every
 * runtime helper inside its body so it has no extension-world closures.
 */
export function extractProblemFromDocument(
  config: ProblemAdapterConfig,
): ProblemContext {
  const normalize = (value: string, limit: number): string =>
    value
      .replace(/\r/g, '')
      .replace(/[\t ]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[^\S\n]{2,}/g, ' ')
      .trim()
      .slice(0, limit);

  const query = (selectors: string[], root: ParentNode = document): Element[] => {
    for (const selector of selectors) {
      try {
        const matches = Array.from(root.querySelectorAll(selector));
        if (matches.length > 0) return matches;
      } catch {
        // A site may roll out selectors unsupported by an older Chrome.
      }
    }
    return [];
  };

  const isTexSource = (element: Element): boolean =>
    element.localName === 'script' &&
    (element.getAttribute('type') ?? '').startsWith('math/tex');

  /**
   * Reading rendered math as text silently corrupts it: MathJax turns
   * `10^5` into `105`, which rewrites a constraint by four orders of
   * magnitude. Restore the TeX source, or failing that the structure, so a
   * bound survives extraction.
   */
  const inlineMath = (root: HTMLElement): void => {
    const replaceWithTex = (host: Element, source: string, display: boolean) => {
      if (!source) {
        host.remove();
        return;
      }
      const fence = display ? '$$' : '$';
      const text = display
        ? '\n' + fence + source + fence + '\n'
        : fence + source + fence;
      host.replaceWith(document.createTextNode(text));
    };

    // KaTeX and hand-written MathML keep the TeX beside the rendered output.
    for (const node of query(['annotation[encoding="application/x-tex"]'], root)) {
      const display = node.closest('.katex-display');
      const host = display ?? node.closest('.katex') ?? node.closest('math') ?? node;
      replaceWithTex(host, node.textContent?.trim() ?? '', Boolean(display));
    }

    // MathJax v2 emits the source as a script next to its rendered frames.
    for (const node of query(['script[type^="math/tex"]'], root)) {
      let sibling = node.previousElementSibling;
      while (
        sibling &&
        Array.from(sibling.classList).some((name) => name.startsWith('MathJax'))
      ) {
        const previous = sibling.previousElementSibling;
        sibling.remove();
        sibling = previous;
      }
      const type = node.getAttribute('type') ?? '';
      replaceWithTex(
        node,
        node.textContent?.trim() ?? '',
        type.includes('mode=display'),
      );
    }

    // MathJax v3 ships no TeX, but its assistive MathML keeps the nesting.
    // Reverse order so an inner script is rewritten before its container.
    for (const node of query(['msup, msub, msubsup'], root).reverse()) {
      const [base, ...scripts] = Array.from(node.children);
      if (!base || scripts.length === 0) continue;
      const marks = node.localName === 'msubsup' ? ['_', '^'] : [];
      const fallback = node.localName === 'msub' ? '_' : '^';
      const suffix = scripts
        .map(
          (part, index) =>
            (marks[index] ?? fallback) + '{' + (part.textContent ?? '') + '}',
        )
        .join('');
      node.replaceWith(document.createTextNode((base.textContent ?? '') + suffix));
    }

    for (const node of query(['sup, sub'], root).reverse()) {
      const value = node.textContent?.trim() ?? '';
      const mark = node.localName === 'sub' ? '_' : '^';
      node.replaceWith(document.createTextNode(value ? mark + '{' + value + '}' : ''));
    }
  };

  const textOf = (
    node: Element | null | undefined,
    limit = 40_000,
    removeSelectors: string[] = [],
  ): string => {
    if (!node) return '';
    const clone = node.cloneNode(true) as HTMLElement;
    const sourceElements = [node, ...Array.from(node.querySelectorAll('*'))];
    const cloneElements = [clone, ...Array.from(clone.querySelectorAll('*'))];
    for (const [index, source] of sourceElements.entries()) {
      // Foreign content such as MathML can make this throw; a statement full of
      // math must not lose the whole extraction to one unstyleable node.
      let style: CSSStyleDeclaration | undefined;
      try {
        style = getComputedStyle(source);
      } catch {
        continue;
      }
      const invisible =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0' ||
        style.fontSize === '0px';
      if (invisible && index === 0) return '';
      if (invisible && !isTexSource(source)) cloneElements[index]?.remove();
    }
    inlineMath(clone);
    clone
      .querySelectorAll(
        '[hidden], [aria-hidden="true"], [style*="display: none"], [style*="display:none"], script, style, noscript',
      )
      .forEach((element) => element.remove());
    for (const selector of removeSelectors) {
      try {
        if (clone.matches(selector)) return '';
        clone.querySelectorAll(selector).forEach((element) => element.remove());
      } catch {
        // Ignore an invalid optional cleanup selector.
      }
    }
    if (!clone.innerText) {
      clone
        .querySelectorAll(
          'address, article, aside, blockquote, br, div, dl, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, tr, ul',
        )
        .forEach((element) => {
          element.before(document.createTextNode('\n'));
          element.after(document.createTextNode('\n'));
        });
    }
    const raw = clone.innerText || clone.textContent || '';
    return normalize(raw, limit);
  };

  const firstText = (
    selectors: string[],
    limit = 40_000,
    removeSelectors: string[] = [],
  ): string => textOf(query(selectors)[0], limit, removeSelectors);

  const unique = (values: string[]): string[] =>
    Array.from(new Set(values.map((value) => normalize(value, 5_000)))).filter(Boolean);

  const embeddedLeetCode = (() => {
    if (config.site !== 'leetcode') return null;

    const scriptNodes = [
      document.getElementById('__NEXT_DATA__'),
      ...query(['script[type="application/json"]']),
    ].filter((node): node is Element => Boolean(node));
    const seen = new Set<Element>();
    let question: Record<string, unknown> | null = null;

    for (const script of scriptNodes) {
      if (seen.has(script)) continue;
      seen.add(script);
      const source = script.textContent?.trim() ?? '';
      if (
        !source ||
        source.length > 5_000_000 ||
        !/(?:questionFrontendId|titleSlug|isPaidOnly)/.test(source)
      ) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(source);
      } catch {
        continue;
      }

      const stack: unknown[] = [parsed];
      let visited = 0;
      while (stack.length > 0 && visited < 20_000) {
        visited += 1;
        const value = stack.pop();
        if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value)) {
          for (const item of value) stack.push(item);
          continue;
        }

        const candidate = value as Record<string, unknown>;
        const hasTitle =
          typeof candidate.title === 'string' ||
          typeof candidate.translatedTitle === 'string';
        const hasContentField =
          Object.hasOwn(candidate, 'content') ||
          Object.hasOwn(candidate, 'translatedContent');
        const hasQuestionIdentity =
          typeof candidate.titleSlug === 'string' ||
          typeof candidate.questionFrontendId === 'string' ||
          typeof candidate.questionId === 'string';
        if (hasTitle && hasContentField && hasQuestionIdentity) {
          question = candidate;
          break;
        }
        stack.push(...Object.values(candidate));
      }
      if (question) break;
    }

    if (!question) return null;
    const preferTranslated = location.hostname.endsWith('.cn');
    const firstString = (...values: unknown[]): string =>
      values.find((value): value is string => typeof value === 'string') ?? '';
    const title = normalize(
      preferTranslated
        ? firstString(question.translatedTitle, question.title)
        : firstString(question.title, question.translatedTitle),
      500,
    );
    const content = preferTranslated
      ? firstString(question.translatedContent, question.content)
      : firstString(question.content, question.translatedContent);
    const template = document.createElement('template');
    template.innerHTML = content;
    const contentRoot = document.createElement('div');
    contentRoot.append(template.content.cloneNode(true));
    const topicTags = Array.isArray(question.topicTags)
      ? question.topicTags
          .map((tag) => {
            if (!tag || typeof tag !== 'object') return '';
            const record = tag as Record<string, unknown>;
            return preferTranslated
              ? firstString(record.translatedName, record.name, record.slug)
              : firstString(record.name, record.translatedName, record.slug);
          })
          .filter(Boolean)
      : [];

    return {
      title,
      contentRoot,
      difficulty: normalize(firstString(question.difficulty), 100),
      topicTags,
      paidOnly: question.isPaidOnly === true,
      contentAvailable: Boolean(content.trim()),
    };
  })();

  const problemSignalPatterns = [
    /\binputs?\b/,
    /\boutputs?\b/,
    /\bconstraint/,
    /\bsamples?\b|\bexamples?\b/,
    /\bprint\b|\bdetermine\b|\bcompute\b|\bgiven\b/,
  ];
  const problemSignalCount = (value: string): number => {
    const lower = value.toLowerCase();
    return problemSignalPatterns.filter((pattern) => pattern.test(lower)).length;
  };

  const sectionText = (selectors: string[]): string =>
    firstText(selectors, 40_000, config.removeSelectors);

  const allText = (selectors: string[], removeSelectors: string[] = []): string[] =>
    query(selectors)
      .map((node) => textOf(node, 20_000, removeSelectors))
      .filter(Boolean);

  const titleNode = query(config.titleSelectors)[0];
  const configuredRoots =
    embeddedLeetCode && textOf(embeddedLeetCode.contentRoot, 120_000)
      ? [embeddedLeetCode.contentRoot]
      : query(config.statementSelectors);
  let inferredGenericRoot: Element | undefined;
  // Client-rendered problem libraries often use only anonymous divs. Walk
  // outward from the title and stop at the first problem-shaped container.
  if (config.site === 'generic' && titleNode) {
    let candidate = titleNode.parentElement;
    while (candidate && candidate !== document.body) {
      const candidateText = normalize(
        (candidate as HTMLElement).innerText || candidate.textContent || '',
        120_000,
      );
      const candidateWords = candidateText.split(/\s+/).filter(Boolean).length;
      if (candidateWords >= 80 && problemSignalCount(candidateText) >= 3) {
        inferredGenericRoot = candidate;
        break;
      }
      candidate = candidate.parentElement;
    }
  }

  const preferInferredRoot =
    inferredGenericRoot &&
    (configuredRoots.length === 0 ||
      (configuredRoots.length === 1 &&
        configuredRoots[0]?.contains(inferredGenericRoot)));
  const roots =
    preferInferredRoot && inferredGenericRoot ? [inferredGenericRoot] : configuredRoots;
  const rootStatement = roots
    .map((root) => textOf(root, 120_000, config.removeSelectors))
    .filter(Boolean)
    .join('\n\n');
  const usedBodyFallback = !rootStatement;
  const statement =
    rootStatement || textOf(document.body, 120_000, config.removeSelectors);

  const sections: ProblemContext['sections'] = [];
  for (const root of roots.slice(0, 3)) {
    const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    for (const heading of headings.slice(0, 50)) {
      const headingText = textOf(heading, 200);
      if (!headingText) continue;

      const bodies: string[] = [];
      let sibling = heading.nextElementSibling;
      while (sibling && !/^H[1-6]$/.test(sibling.tagName)) {
        const value = textOf(sibling, 10_000, config.removeSelectors);
        if (value) bodies.push(value);
        sibling = sibling.nextElementSibling;
      }

      const body = normalize(bodies.join('\n\n'), 40_000);
      if (body) sections.push({ heading: headingText, body });
    }
  }

  const sectionByName = (pattern: RegExp): string | undefined =>
    sections.find(({ heading }) => pattern.test(heading))?.body;

  const input =
    sectionText(config.inputSelectors) ||
    sectionByName(/^(?:the\s+)?input(?:\s+(?:data|format|specification))?\s*:?\s*$/i);
  const output =
    sectionText(config.outputSelectors) ||
    sectionByName(/^(?:the\s+)?output(?:\s+(?:data|format|specification))?\s*:?\s*$/i);

  const explicitConstraints = allText(
    config.constraintsSelectors,
    config.removeSelectors,
  ).flatMap((text) => text.split('\n'));
  const sectionConstraints = sections
    .filter(({ heading }) => /constraint|limit/i.test(heading))
    .flatMap(({ body }) => body.split('\n'));
  const leetcodeConstraints =
    config.site === 'leetcode'
      ? roots.flatMap((root) => {
          const label = Array.from(root.querySelectorAll('strong, b')).find((node) =>
            /^constraints?\s*:?$/i.test(textOf(node, 100)),
          );
          const list = label?.closest('p')?.nextElementSibling;
          return list?.matches('ul, ol')
            ? Array.from(list.querySelectorAll('li')).map((node) => textOf(node, 5_000))
            : [];
        })
      : [];
  const constraints = unique([
    ...explicitConstraints,
    ...sectionConstraints,
    ...leetcodeConstraints,
  ]).slice(0, 100);

  let sampleInputs = allText(config.sampleInputSelectors);
  let sampleOutputs = allText(config.sampleOutputSelectors);
  let explanations = allText(config.explanationSelectors, config.removeSelectors);

  if (sampleInputs.length === 0) {
    sampleInputs = sections
      .filter(({ heading }) => /^sample input\b/i.test(heading))
      .map(({ body }) => body);
  }
  if (sampleOutputs.length === 0) {
    sampleOutputs = sections
      .filter(({ heading }) =>
        /^(?:sample output|output for sample input)\b/i.test(heading),
      )
      .map(({ body }) => body);
  }
  if (explanations.length === 0) {
    explanations = sections
      .filter(({ heading }) => /^explanation\b/i.test(heading))
      .map(({ body }) => body);
  }

  if (
    (config.site === 'generic' || config.site === 'leetcode') &&
    sampleInputs.length === 0 &&
    sampleOutputs.length === 0
  ) {
    const preformatted = roots
      .flatMap((root) => Array.from(root.querySelectorAll('pre')))
      .map((node) => textOf(node, 20_000))
      .filter(Boolean);

    const splitLabeledSample = (
      value: string,
    ): { input: string; output: string; explanation?: string } | null => {
      let sampleInput: string;
      let sampleOutput: string;
      let explanation = '';

      if (config.site === 'leetcode') {
        const inputLabel = /\bInput\s*:\s*/i.exec(value);
        const afterInput = inputLabel
          ? value.slice((inputLabel.index ?? 0) + inputLabel[0].length)
          : '';
        const outputLabel = /\bOutput\s*:\s*/i.exec(afterInput);
        if (!inputLabel || !outputLabel) return null;
        const afterOutput = afterInput.slice(
          (outputLabel.index ?? 0) + outputLabel[0].length,
        );
        const explanationLabel = /\bExplanation\s*:\s*/i.exec(afterOutput);
        sampleInput = normalize(afterInput.slice(0, outputLabel.index ?? 0), 20_000);
        sampleOutput = normalize(
          explanationLabel
            ? afterOutput.slice(0, explanationLabel.index ?? 0)
            : afterOutput,
          20_000,
        );
        explanation = explanationLabel
          ? normalize(
              afterOutput.slice(
                (explanationLabel.index ?? 0) + explanationLabel[0].length,
              ),
              20_000,
            )
          : '';
      } else {
        // Generic pages need labels at line boundaries so ordinary
        // preformatted text is never split accidentally.
        const match = value.match(
          /(?:^|\n)[ \t]*(?:sample[ \t]+)?input[ \t]*:[ \t]*(?:\n|$)([\s\S]*?)(?:^|\n)[ \t]*(?:sample[ \t]+)?output[ \t]*:[ \t]*(?:\n|$)([\s\S]*)/im,
        );
        if (!match) return null;
        sampleInput = normalize(match[1] ?? '', 20_000);
        sampleOutput = normalize(match[2] ?? '', 20_000);
      }

      return sampleInput || sampleOutput
        ? {
            input: sampleInput,
            output: sampleOutput,
            ...(explanation ? { explanation } : {}),
          }
        : null;
    };
    const labeledSamples = preformatted
      .map(splitLabeledSample)
      .filter(
        (sample): sample is { input: string; output: string; explanation?: string } =>
          sample !== null,
      );

    if (labeledSamples.length > 0) {
      sampleInputs = labeledSamples.map((sample) => sample.input);
      sampleOutputs = labeledSamples.map((sample) => sample.output);
      explanations = labeledSamples.map((sample) => sample.explanation ?? '');
    } else if (
      config.site === 'generic' &&
      preformatted.length >= 2 &&
      preformatted.length % 2 === 0
    ) {
      sampleInputs = preformatted.filter((_, index) => index % 2 === 0);
      sampleOutputs = preformatted.filter((_, index) => index % 2 === 1);
    }
  }

  const sampleCount = Math.max(sampleInputs.length, sampleOutputs.length);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const explanation = explanations[index] || explanations[0];
    return {
      input: sampleInputs[index] ?? '',
      output: sampleOutputs[index] ?? '',
      ...(explanation ? { explanation } : {}),
    };
  }).filter(({ input: sampleInput, output: sampleOutput }) =>
    Boolean(sampleInput || sampleOutput),
  );

  const title =
    embeddedLeetCode?.title ||
    textOf(titleNode, 500) ||
    normalize(document.title.replace(/\s*[-|].*$/, ''), 500) ||
    'Untitled problem';

  const rawTags = unique([
    ...(embeddedLeetCode?.topicTags ?? []),
    ...query(config.tagSelectors).map((node) => textOf(node, 100)),
  ]);
  const explicitRating =
    embeddedLeetCode?.difficulty || firstText(config.ratingSelectors, 100);
  const ratingTag = rawTags.find((tag) => /^\*\d+$/.test(tag));
  const rating = explicitRating || ratingTag;
  const parsedCodeforcesRating =
    config.site === 'codeforces' ? Number(rating?.match(/\d{3,4}/)?.[0]) : NaN;
  const officialCodeforcesRating =
    Number.isInteger(parsedCodeforcesRating) &&
    parsedCodeforcesRating >= 800 &&
    parsedCodeforcesRating <= 4_000
      ? parsedCodeforcesRating
      : null;
  const timeLimit = firstText(config.timeLimitSelectors, 200);
  const memoryLimit = firstText(config.memoryLimitSelectors, 200);
  const tags = rawTags
    .filter((tag) => tag !== ratingTag)
    .map((tag) => tag.replace(/^x\d+\s*/i, '').trim())
    .filter(Boolean);

  const wordCount = statement.split(/\s+/).filter(Boolean).length;
  const problemSignals = problemSignalCount(statement);

  let confidence = config.baseConfidence;
  if (title.length > 2) confidence += 0.01;
  if (wordCount > 80) confidence += 0.03;
  if (input || output) confidence += 0.03;
  if (samples.length > 0) confidence += 0.02;
  if (config.site === 'generic') {
    confidence = Math.min(0.82, confidence + problemSignals * 0.08);
    if (wordCount < 40) confidence -= 0.2;
    if (usedBodyFallback) confidence -= 0.12;
  }
  const leetcodeUnavailable =
    config.site === 'leetcode' &&
    (usedBodyFallback ||
      (embeddedLeetCode?.paidOnly === true && !embeddedLeetCode.contentAvailable) ||
      /subscribe to unlock|premium subscription|content unavailable/i.test(statement));
  if (leetcodeUnavailable) confidence = Math.min(confidence, 0.45);

  const warnings: string[] = [];
  if (wordCount < 80) warnings.push('The extracted statement is unusually short.');
  if (
    !input &&
    !output &&
    config.site !== 'advent-of-code' &&
    config.site !== 'leetcode'
  ) {
    warnings.push('Input and output sections were not identified separately.');
  }
  if (config.site === 'generic') {
    warnings.push('This page used the generic problem extractor.');
    if (usedBodyFallback) {
      warnings.push('The generic extractor could not isolate a problem container.');
    }
  }
  if (config.site === 'leetcode' && leetcodeUnavailable) {
    warnings.push(
      embeddedLeetCode?.paidOnly
        ? 'This LeetCode statement appears to require an account or Premium access.'
        : 'The LeetCode description was not ready. Wait for the page to load and use Read again.',
    );
  }

  return {
    version: 1,
    source: {
      url: location.href,
      host: location.host,
      site: config.site,
      extractedAt: Date.now(),
    },
    title,
    statement,
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    constraints,
    samples,
    ...(timeLimit ? { timeLimit } : {}),
    ...(memoryLimit ? { memoryLimit } : {}),
    ...(rating ? { rating } : {}),
    ...(officialCodeforcesRating
      ? {
          codeforcesRating: {
            value: officialCodeforcesRating,
            source: 'official' as const,
          },
        }
      : {}),
    tags,
    sections,
    confidence: Math.max(0, Math.min(1, confidence)),
    warnings,
  };
}
