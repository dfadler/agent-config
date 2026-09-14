# Grading a static a11y review

This review has no browser and no rule engine — it reads source only. That bounds
what any finding can honestly claim. The evidence-basis/severity split below is
adapted from [AccessLint](https://github.com/AccessLint/skills)'s methodology (MIT)
for a live-DOM audit; the grade definitions here are rewritten for what source
inspection alone can and can't support. See `../../../NOTICE.md`.

The stance: this review augments a real check, it doesn't replace one. A finding
here is a starting point for a scanner (axe-core, Lighthouse) and human/AT testing,
not a substitute for either.

## Two axes, kept separate

Every finding gets a severity (user impact) and an evidence basis (what source
alone can support). A finding can be serious-and-●, or serious-and-◐ — those mean
different things to whoever reads the report.

### Evidence basis — what static source can prove

- **● Verified** — a deterministic, syntactic fact the source settles on its own:
  an attribute is absent, an element type is wrong, a heading level is skipped, a
  `tabindex` is positive. Cite the file, line, and the exact snippet. Examples:
  missing `alt`, an interactive `div`/`span` with no `role`/`tabIndex`/keydown
  handler, a form input with no associated `label`/`aria-label`, `autofocus`
  present, missing `lang` on `html`, a skipped heading level, a positive
  `tabindex`, a `title`-attribute-only tooltip.
- **◐ Flagged** — the source gives real evidence, but the actual failure depends on
  computed/rendered state this review can't observe: a literal color pair that
  looks low-contrast (real contrast needs computed styles, not just the two
  literals in source), a focus style that exists in source but whose visibility
  can't be confirmed without rendering, a custom widget whose ARIA looks
  plausible but whose keyboard operability can't be confirmed from markup alone.
  State the source evidence and what a scanner or visual check would need to
  confirm it.
- **○ Human-required** — needs a screen reader, other assistive technology, or
  lived experience to settle: whether an `aria-live` region actually announces
  usefully, whether reading order matches visual order in a complex layout,
  whether alt text is contextually adequate (not just present). Name the
  functional ability and AT that would reveal it; don't guess the outcome.

When unsure between two grades, use the lower one. A finding that stacks a
deterministic fact under an interpretive call takes the lower grade — e.g. "this
status indicator has no programmatic role" is ● (a fact from source); "color is
the only way it conveys status" is ◐ (position or icon could also carry it, and
source alone can't rule that out).

### Severity — user impact, independent of evidence basis

- **Critical** — blocks a core task with no workaround (an unlabeled sole submit
  control; a custom modal with no way to close via keyboard).
- **Serious** — a major barrier; the task is possible but difficult (illogical
  DOM/focus order through a form; body-text colors that read as clearly failing
  contrast).
- **Moderate** — noticeable friction; the task still completes (missing skip
  link; a redundant or noisy live region).
- **Minor** — a small inefficiency or polish issue (slightly low contrast on a
  non-essential decorative control).

## Evidence budget

Spend proof in proportion to the grade a finding can reach:

- **●** — cite the file:line and the exact snippet once. Don't re-derive the same
  fact for every instance of an obviously-repeated pattern; note the pattern and
  the count.
- **◐** — one citation, one sentence of reasoning, and the concrete check that
  would confirm or refute it (a specific axe-core rule ID, a manual contrast
  check, a resize test). Don't gather more; more source-reading doesn't turn a
  ◐ into a ●, it only costs more.
- **○** — no source-diving to "strengthen" it. Name the ability, the AT, and stop.

## Grounding and honesty

- Ground every finding in a file, line, and snippet. Don't fabricate a location or
  assume a pattern repeats elsewhere without checking.
- Don't invent remediation content — placeholder alt text, label copy, or link
  text. Where the fix is mechanical (add an attribute, swap an element), state
  it; where it needs judgment (what the alt text should say), leave a `TODO`
  naming the criterion instead of guessing.
- Say explicitly what this review cannot cover: computed contrast, actual
  keyboard/screen-reader behavior, anything needing a rendered page. Silence
  there reads as "checked and passed," which this review never earns on its own.
