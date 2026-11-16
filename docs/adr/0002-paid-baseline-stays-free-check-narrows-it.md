# The paid no-plugin baseline stays; the free discrimination check only narrows it

Nothing free produces a no-plugin reply, and only `last_message` `regex`
graders can run offline, so no free step can show that a case tells the plugin
from no plugin. We keep the paid baseline (author-cases step 7) and add one
module that reports a case's discrimination state before the run (from graders
and a stored bad reply) and the ceiling after it, sharing one threshold. It
reports "unproven" rather than OK whenever it cannot run the graders.

EVAL008 (every grader excluded) and EVAL009 (no scored result grader) stay
outside the module: they ask whether the delta can be inflated or the result is
graded, not whether the case can fail. Their reshaping (#932, #933) and the
deletion of EVAL010 and EVAL003 (see `docs/lint-rules.md`) are not reopened by
this decision.

## Considered Options

- Replace the paid baseline with a free check: rejected, it cannot produce a
  no-plugin reply.
- Fold EVAL008/009 into the module: rejected, different question, and the CLI
  overlap probe already drove their current shape.
