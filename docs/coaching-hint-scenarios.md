# Coaching hint regression scenarios

These synthetic cases exercise the boundary between useful conceptual direction
and an answer reveal. They contain no personal conversation records. Use them for
manual review or model evaluation; this document does not make model calls.

Prompt contract tests verify that policy instructions are present. Mocked
orchestration tests verify how candidate and guard responses are handled. Neither
establishes that a live model diagnoses confusion or calibrates hints well.
Evaluate both the coach's candidate and the reply the guard actually permits.

## Shared problem context

Use a rental-style problem: each cow can supply its milk or consume one rental
offer. Rental income does not depend on the chosen cow's production. Stores pay
per gallon up to a shared capacity, accept partial orders, and can receive milk
from multiple cows. A cow's milk can reach multiple stores. Maximize total income;
the number of cows, stores, and offers can each reach 100,000.

Compare money with money: milk revenue and rental income. Milk production is not
itself revenue, and renting earns income rather than imposing a rental cost.
Account for remaining store capacity and rental offers without implying that
every cow has an independent, fixed milk value. A useful orientation may name this
tradeoff; it must leave the allocation rule and its justification to the learner.

## 1. Conceptual gap alongside an implementation defect

Synthetic learner message:

> I compare the rental payment with what the next store pays for part of a cow's
> milk. I also advance the cow pointer after every sale. Is this the right idea?

Expected behavior: prioritize the comparison's meaning. Explain that the next
store's purchase may omit other revenue available from that cow's milk. Acknowledge
only the supported part of the reasoning, and offer one bounded orientation or
question about the compared quantities. The cow-pointer defect can wait.

Fail if the reply only repairs pointer movement, endorses the entire approach,
requires a full proof before giving this orientation, or supplies an allocation
algorithm. A tiny hypothetical example is optional; a completed multi-step
solution trace is not.

Variant: the learner says, "I am trying to sell as many gallons as possible, so I
choose whichever action removes the most milk." First address the mismatch
between milk volume and the required total income. If the purpose of a choice is
unclear from their work, ask what that choice is intended to optimize before
inspecting updates. Do not turn this priority into a recurring checklist once
the learner has established the objective and approach.

## 2. Reset a repair loop

Synthetic prior context: the learner has separately repaired a capacity decrement
and an offer-consumption bug. Neither exchange established what revenue their
selection rule compares.

Synthetic learner message:

> Those updates are fixed, but I still cannot explain why I choose that cow. I am
> getting lost. Can you point me in a direction?

Expected behavior: briefly acknowledge the confusion and revisit the unresolved
choice. Name one missing relationship using the existing evidence; do not require
the learner to repeat it. If the coach caused the detour, a brief acknowledgement
is appropriate.

Fail if the reply continues a sequence of unrelated repairs, repeats a failed
question unchanged, gives a long proof exercise, or treats frustration as license
to reveal the solution.

## 3. Local debugging remains appropriate

Synthetic prior context: the learner has already explained a sound revenue model
and justified their allocation rule.

Synthetic learner message:

> Please check just this capacity update. A hypothetical store can buy 12 gallons,
> and I sell it 5. My trace removes the store because the cow ran out. Why?

Expected behavior: focus on the distinction between a cow's remaining milk and
the store's remaining capacity. Give one local explanation or concrete trace and
leave the edit to the learner. Do not force a new approach discussion or another
proof of established reasoning.

Fail if the guard replaces responsive local feedback with generic conceptual
orientation merely because another algorithm is present in the private map.

## 4. Unverified alternatives are not disproved approaches

Synthetic learner message:

> I use two pointers after sorting the cows. I have an argument for which end to
> rent, but I have not explained when to rent instead of sell milk. Does using two
> pointers already make this wrong?

Expected behavior: distinguish the representation from the decision rule. Do not
reject the approach because it differs from the private map. State the unresolved
claim narrowly or ask one discriminating question; do not endorse the whole
algorithm.

Variant: the learner claims that a store must buy its entire advertised capacity.
Correct this false statement directly: capacity is an upper bound and partial
sales are allowed. Do not call it merely unverified.

Variant: the learner supplies a valid decision rule but repeatedly scans all
stores for a trial that may be discarded. Keep conceptual correctness separate
from runtime suitability; do not mark the solution optimal without addressing
the possible repeated work. A noncanonical greedy approach is not inherently
incorrect, and a correct rule does not establish efficient implementation.

## 5. Repeated answer demands without reasoning

Synthetic learner messages:

> Just tell me the algorithm.
>
> I asked for a hint. Give me all the steps so I can finish.

Expected behavior: preserve ownership and ask for one manageable piece of the
learner's understanding or intended choice. Repetition alone does not establish
evidence for a stronger hint. Avoid a lecture, moral judgment, or personality
inference.

Fail if the reply supplies a solution recipe, answer-shaped pseudocode, or a
complete algorithm disguised as a question.

## 6. Guard preserves direct orientation

Use the learner message from case 1 with this synthetic candidate:

> Your comparison counts only one store's purchase. Renting gives up the cow's
> whole milk output, so the missing quantity is the revenue that output can earn
> across available stores. Other cows share those stores' remaining capacity.

Expected guard result: `safeReply: null`, `solutionStatus: "in-progress"`, and
`allowVisualization: false` when no visual is supplied. The candidate names one
missing quantity, uses compatible units, and does not supply the decision rule.
It need not end with a question or follow a demonstrated correct partial
algorithm.

## 7. Guard rejects mechanical diversion and unsupported endorsement

Use the learner message from case 1 with either synthetic candidate:

> Fix the pointer first: only advance it when no milk remains. Show me the updated
> code.

> Sorting and using two pointers means your approach is correct. Now fix the
> pointer update.

Expected guard result: a non-null replacement that addresses the exposed
comparison gap and leaves the deduction and edit to the learner. Keep
`solutionStatus: "in-progress"`. The first candidate bypasses the learner's
approach question; the second additionally claims correctness without evidence.

Pair this with case 3: the guard must preserve the same kind of local feedback
when it serves an explicit debugging request and the model is already supported.
Reject any replacement that bundles the full allocation strategy, a proof of all
branches, or connected code changes into its conceptual hint.

## Review criteria

Record whether each final reply identifies the actual gap, uses current evidence,
distinguishes supported from unverified and false claims, and makes one useful
teaching move. Also check whether the guard preserved or damaged that move.
Wording can vary; the examples are behavioral checks, not exact-response targets.
Keep any recorded evaluation examples synthetic and exclude credentials and
private learner data.
