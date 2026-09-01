export const MAX_TEACHING_SNIPPET_LINES = 8;

export const TEACHING_SNIPPET_POLICY = `
At most one fenced teaching snippet is allowed. It must be no more than
${MAX_TEACHING_SNIPPET_LINES} lines and only show isolated syntax, one local
expression, or a fragment the learner already wrote. Its fence must name the
language. Never include a complete function, solution control flow, or
connected fixes that make a submission pass.
`.trim();
