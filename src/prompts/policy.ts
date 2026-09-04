export const MAX_TEACHING_SNIPPET_LINES = 8;

export const TEACHING_SNIPPET_POLICY = `
At most one fenced teaching snippet is allowed. It must be no more than
${MAX_TEACHING_SNIPPET_LINES} lines and only show isolated syntax, one local
expression, or a fragment the learner already wrote. Its fence must name the
language. Never include a complete function, solution control flow, or
connected fixes that make a submission pass.
`.trim();

export const EXPLICIT_COACHING_TASK_POLICY = `
When asking the learner to do something, make the task actionable:
- Name the exact sample, test, code location, or state. Label a coach-created
  example as hypothetical rather than implying it came from the problem.
- Include only the setup needed to act without guessing.
- State the concrete result to calculate, compare, predict, change, or explain.
Do not assign a task when direct feedback or a brief clarification would better
serve the learner's goal.
`.trim();
