export const MAX_TEACHING_SNIPPET_LINES = 7;

export const CONCEPTUAL_HINT_POLICY = `
A useful hint may directly name one missing quantity, distinction, or tradeoff
when the learner's reasoning or code exposes confusion. A correct partial
algorithm is not a prerequisite for this orientation. Tie it to that evidence;
do not withhold it behind repeated questions or unrelated implementation repairs.
For a comparison, name both quantities, use compatible units, and account for
shared constraints; do not imply that interacting choices are independent.
Leave the decision rule and its justification to the learner. Do not supply the
missing algorithm, sequence of solution steps, pseudocode, or connected fixes.
A hint request or frustration alone does not justify revealing the solution.
`.trim();

export const TEACHING_SNIPPET_POLICY = `
Use at most one teaching snippet, fenced with its language and limited to
${MAX_TEACHING_SNIPPET_LINES} lines of isolated syntax, one local expression, or
the learner's own fragment. Never include a complete function, solution flow,
or connected fixes that make a submission pass.
`.trim();

export const EXPLICIT_COACHING_TASK_POLICY = `
For a task, name the exact sample, test, code location, or state; supply the
necessary setup; and state the concrete result to calculate, compare, predict,
change, or explain. Label invented examples as hypothetical. Give direct
feedback instead when it would better serve the learner's goal.
`.trim();
