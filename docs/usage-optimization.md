# Usage optimization: where Claude Code cost is spent in this repo

Static-analysis audit for [#90](https://github.com/dfadler/agent-config/issues/90).
This is a **configuration audit, not a measured usage breakdown** — there is no
access to this account's billing history or a live token-usage dashboard from
inside a coding session. Two numbers below *are* measured (not guessed): the
plugin's own projected-token-cost tool, and file line/byte counts from this
checkout. Everything else is inferred from reading the config files that ship
in this repo. Each finding below is marked **Confirmed** (grounded in a
specific file, line, or tool output) or **Speculative** (a plausible inference
that would need real session telemetry to confirm) — see "Confidence" at the
end of each item.

Scope: `claude/CLAUDE.md`, `plugins/dfadler-agent-config/agents/*.md`,
`plugins/dfadler-agent-config/skills/*/SKILL.md`, `claude/commands/*.md`,
`docs/`, `.github/workflows/`. No file was modified as part of this audit —
see the PR this ships in for why.

## Method

- Read every in-scope file in full (line counts below via `wc -l`).
- `grep -rn '^model:'` and `grep -rn -i 'opus\|sonnet\|haiku'` across
  `plugins/` and `claude/` for model-tier overrides.
- `grep -rln 'effort'` across the same tree for reasoning-effort knobs.
- Ran `claude plugin details dfadler-agent-config` — this is a real,
  built-in Claude Code command that estimates the plugin's own context-token
  footprint from its manifest; it is not billing data, but it is a measured
  artifact of this checkout's actual files, not a guess.
- Fetched the current [Manage costs effectively](https://code.claude.com/docs/en/costs)
  doc for the authoritative guidance this audit measures the repo against
  (CLAUDE.md size, model-tier selection, cache lifetime, agent-team
  multiplier) — quoted inline below per this repo's own citation convention.
- `git log` on the files with the most findings, to check churn rate.

## Findings by area

### 1. Model tier selection

**Confirmed — updated since this audit first shipped (2026-08-29).** Three
`model:` overrides now exist in the plugin, one per agent (`grep -rn
'^model:' plugins/dfadler-agent-config/agents/*.md`):

- `plugins/dfadler-agent-config/agents/adversarial-reviewer.md:12` — `model: opus`
- `plugins/dfadler-agent-config/agents/docs-staleness-checker.md:17` — `model: sonnet`
- `plugins/dfadler-agent-config/agents/shell-script-reviewer.md:13` — `model: haiku`

No skill sets a model — only agents carry a `model:` field in this plugin.
The original version of this finding said "exactly one override" and "the
only subagent defined in the whole repo"; both are now stale —
`plugins/dfadler-agent-config/agents/` has three files, not one, and each
picks a different tier.

The official guidance: "Sonnet handles most coding tasks well and costs less
than Opus. Reserve Opus for complex architectural decisions or multi-step
reasoning... For simple subagent tasks, specify `model: haiku` in your
subagent configuration." ([code.claude.com/docs/en/costs](https://code.claude.com/docs/en/costs))
Read against that guidance, each of the three choices matches the task shape
it's assigned to:

- **`adversarial-reviewer` → opus.** "Hunt for hidden bugs, security flaws,
  concurrency issues... follow calls into their definitions and check the
  callers of anything you touch" (`adversarial-reviewer.md:19-51`) is
  multi-step, cross-file reasoning — the class the docs reserve Opus for.
- **`docs-staleness-checker` → sonnet.** Cross-referencing prose claims
  against code/config across a whole doc tree, checking named scripts,
  commands, and counts still match reality (`docs-staleness-checker.md:19-40`),
  is ordinary coding-adjacent reasoning — the "most coding tasks" class the
  docs point at Sonnet.
- **`shell-script-reviewer` → haiku.** Running shellcheck/shfmt and checking
  a fixed checklist (`set -uo pipefail` placement, a justification comment
  above each disable, `-h`/`--help` handling) against explicit named rules
  (`shell-script-reviewer.md:33-79`) is the "simple subagent task" class the
  docs point at Haiku.

None of the three files has a comment explaining *why* that tier was chosen,
so all three still read as plausible-by-task-shape rather than documented
decisions. But this changes the shape of the finding from the original
version: it's no longer one isolated, unexplained override to question —
it's a small, undocumented but seemingly well-calibrated tier ladder, with
each agent's cost matched to its reasoning complexity per the docs' own
criteria.

Confidence: the three overrides and their task-shape match are Confirmed
(grep + read of all three files). Whether Opus specifically is *necessary*
for `adversarial-reviewer` vs. Sonnet-with-escalation remains Speculative —
that would need a real before/after comparison of review quality on the same
diffs, which this audit can't run.

### 2. Prompt caching: is CLAUDE.md a stable, cache-friendly prefix?

**Confirmed, structurally.** `claude/CLAUDE.md` is written as topic-scoped
`##` sections, each added as its own commit (see churn note below) rather
than rewritten in place — that's a genuinely cache-friendly *shape*: new
content appends, old content doesn't get reworded. Compare the section list:
worktrees (`CLAUDE.md:8-61`), visual verification (`:63-93`), TypeScript
assertions (`:95-109`), JS/TS comments (`:111-143`), focus-stealing (`:145-176`),
answer-shape (`:178-193`), shell hygiene (`:195-229`), sabotage testing
(`:231-242`), tooling-over-scanning (`:244-260`), dependency audits
(`:261-275`), secrets handling (`:277-290`), citation discipline (`:292-299`),
GitHub workflow habits (`:301-352`) — 13 largely independent topics, additive.

**But two things work against caching/context economy regardless of shape:**

- **Size.** `claude/CLAUDE.md` is 352 lines / 24,871 bytes (`wc -l`/`wc -c`),
  ≈6,200 tokens at a rough 4 chars/token estimate. The docs: "Aim to keep
  CLAUDE.md under 200 lines by including only essentials"
  ([costs doc](https://code.claude.com/docs/en/costs), "Move instructions
  from CLAUDE.md to skills"). This file is 76% over that guideline, and
  because it's the *global* `~/.claude/CLAUDE.md`, it is loaded in full at
  the start of **every** session in **every** project on this machine,
  regardless of relevance.
- **Relevance mismatch is real, not hypothetical.** Two full sections —
  "TypeScript: avoid type assertions" (`CLAUDE.md:95-109`, 15 lines) and
  "JS/TS: comment syntax" (`:111-143`, 33 lines), 48 lines / ~13% of the
  file — are language-specific to TypeScript/JavaScript. This very repo
  (agent-config) contains zero TypeScript/JavaScript; it's Bash and Python
  (`Makefile:1-30`, `requirements-dev.txt`). Every session in *this* repo
  pays for those 48 lines with no possible use for them this session. That's
  the literal shape of the issue's "content always loaded into context but
  rarely relevant" question — confirmed to exist, at a small but nonzero
  scale (~13% of one always-on file, in this one repo).

**Churn rate.** `git log --format=%ad --date=short -- claude/CLAUDE.md | sort |
uniq -c` shows the file was created 2026-08-26 and has been touched on every
day since: 3 commits (08-26), 5 (08-27), 22 (08-28), 18 (08-29) — 48 commits
in 4 days. The 5-minute default / 1-hour extended TTL is an *inactivity*
timeout, and every request that hits the cache resets it — so a session that
stays active resets its own clock and can, in principle, stay warm across
several days without ever going cold on that basis alone. Cross-day file
changes to `CLAUDE.md` are not automatically harmless, then: whether they
invalidate a long-lived cache depends on whether the changed content sits in
the stable prefix a running session is still relying on, which this audit
did not measure. What the commit count *does* establish, on its own: 48
commits touching one file in 4 days is a lot of edit activity, and each edit
is at minimum a write to that file. Whether each commit also required Claude
to read or diff the *whole* file (rather than a targeted edit) isn't
something `git log` can show — that would need session/tool telemetry this
audit didn't have access to, so that stronger claim is marked Unmeasured
rather than asserted.

Confidence: line/byte counts and churn commit counts are Confirmed
(direct tool output). Whether cross-day cache effects are actually being lost
to this churn, and whether each commit cost a full-file read/diff, are
Unmeasured — flagged above rather than asserted. The claim that 352 lines
meaningfully raises per-session cost vs. a 200-line file, and that the
TypeScript sections are "waste" in *this* repo specifically, are Confirmed as
facts about this
repo's content but Speculative as a claim about aggregate cost impact across
this user's *other* (TS-containing) repos, where the same content is fully
relevant every session.

### 3. Subagent / workflow fan-out costs

**Confirmed: no problematic fan-out found in this repo.**
`claude/commands/adversarial-review.md` launches exactly one subagent
(`dfadler-agent-config:adversarial-reviewer`, `adversarial-review.md:5`) per
invocation — no parallel fan-out to audit here. The plugin now defines two
more agents, `shell-script-reviewer` and `docs-staleness-checker` (§1), but
neither is wired to a slash command or any other in-repo caller (`grep -rln`
for either name across `claude/commands/` and
`plugins/dfadler-agent-config/skills/` returns nothing) — they're invoked
only via the generic Agent-tool selection a session makes from their
descriptions, one at a time, not fanned out from a command. This finding
still holds with three agents in the repo instead of one. The issue's own text names
`pr-review-rubric` as an example to check for fan-out, but
`plugins/dfadler-agent-config/skills/pr-review-rubric/SKILL.md` is a
**methodology/rubric skill**, not an orchestrator — it explicitly says "This
skill is the rubric and the output contract — it does not decide *when* to
run or *where* to post comments; the orchestrating prompt that invoked you
covers that" (`SKILL.md:23-25`). The orchestrating prompt it refers to
(`pr-review.md`, referenced at `SKILL.md:493`) **does not exist in this
repo** — grep confirms it's mentioned once, defined nowhere. This skill is
built to be consumed by a *different* repo's own CI pipeline (consistent
with the recent commit history: `3f60fc6 fix(pr-review-rubric): genericize
dfadler.com-specific content`, 2026-08-27 — it used to be
dfadler.com-specific and was generalized for reuse). Any actual fan-out cost
from this rubric is incurred in whatever repo wires it up, which is outside
this audit's visibility.

**One real, sizeable cost exists within this repo's own boundary:** the
rubric's *own* size. `claude plugin details dfadler-agent-config` (measured,
not estimated by hand, re-run for this update) now reports:

```text
Component inventory
  Skills (16)  changesets-authoring, collab-retro, detached-terminal,
               fetch-execute-guide, gh-attach-image, gh-publish-guide,
               git-worktree-usage, github-pr-workflow,
               issue-reporter-etiquette, linux-administration, pr-babysit,
               pr-checks, pr-comments, pr-review-rubric, pr-visual-capture,
               typescript-conventions
  Agents (3)   adversarial-reviewer, shell-script-reviewer,
               docs-staleness-checker

Projected token cost
  Always-on:   ~4,121 tok   added to every session

Per-component (rounded, highest on-invoke first)
  component                 always-on  on-invoke
  pr-review-rubric               ~340     ~10.4k
  pr-visual-capture              ~210      ~6.1k
  linux-administration           ~340      ~5.5k
  pr-comments                    ~210      ~4.6k
  pr-babysit                     ~260      ~4.4k
  git-worktree-usage             ~250        ~4k
  changesets-authoring           ~220      ~2.7k
  detached-terminal              ~270      ~2.3k
  issue-reporter-etiquette       ~220        ~2k
  gh-publish-guide               ~240      ~1.9k
  shell-script-reviewer          ~160      ~1.9k
  gh-attach-image                ~210      ~1.5k
  collab-retro                   ~210      ~1.5k
  github-pr-workflow              ~80      ~1.4k
  fetch-execute-guide            ~230      ~1.1k
  typescript-conventions         ~160       ~940
  adversarial-reviewer           ~130       ~880
  docs-staleness-checker         ~220       ~870
```

**This section's numbers were more stale than the two new agents alone
account for.** Since this audit shipped (2026-08-29), the plugin grew from 5
skills to 16 (11 new: `changesets-authoring`, `collab-retro`,
`fetch-execute-guide`, `git-worktree-usage`, `github-pr-workflow`,
`issue-reporter-etiquette`, `linux-administration`, `pr-checks`,
`pr-comments`, plus two more) and from 1 agent to 3. Always-on cost more
than tripled, ~1,243 → ~4,121 tokens. A full re-audit of the 11 newly-added
skills is outside what this pass was asked to do (it was scoped to the two
new *agents*) — flagged here rather than left silently wrong, since the raw
numbers in this section are directly measurable and were wrong.

`pr-review-rubric` is still the single most expensive on-invoke component in
the plugin, now ~10.4k tokens per load (up from ~8.8k, consistent with the
file growing from 576 to 677 lines, `wc -l`). Since the rubric documents a
"push-path re-check... re-verifying your own open threads on every push with
no human in the loop" (`SKILL.md:493-494`) as part of its intended usage
pattern in a consuming repo, an automation that reloads this skill fresh on
every push to every open PR pays that ~10.4k-token cost per reload, per PR,
per push — that compounds fast in a busy repo, but the actual reload
frequency lives in a CI config this repo doesn't contain, so the multiplier
is unknown from here.

Always-on cost across the whole plugin (~4,121 tokens) is the sum of 19
component *descriptions* — 16 skills' plus the 3 agents' — not the
components' full content, which only loads on invoke (that's the
~870–~10.4k on-invoke column above). Still small relative to `CLAUDE.md`'s
own ~6,200-token footprint (§2), though the margin has narrowed as the
plugin has grown — and it's still the unavoidable cost of triggering
descriptions; skills (and agents) are already the correct on-demand
mechanism here (see §5).

Confidence: the plugin-details numbers are Confirmed (tool output, this
session, this checkout, re-run for this update). The claim about compounding
cost from repeated push-path reloads in a consuming repo is Speculative — no
such repo's CI config is in scope here.

### 4. Background task / polling patterns

**Confirmed: nothing found that polls needlessly.** The only skill in this
repo that mentions `/loop` or polling-style operation is `pr-babysit`
(`plugins/dfadler-agent-config/skills/pr-babysit/SKILL.md`), and it's
designed against exactly the waste this section of the issue asks about: it
runs **one pass and stops** (`SKILL.md:20-22`, "a single invocation is
exactly one pass"), and it ends every pass with an explicit pacing hint for
whatever's driving it under `/loop` — `PACING: short` only "while anything is
in flight or actionable," `PACING: long` when "everything is quiet" (`:298-306`,
`:70-71`). That's the dynamic-interval pattern the issue is asking whether
this repo has; it does. No cron/scheduled-task config, no fixed short-interval
loop, and no other skill or command references `/loop` or `scheduled` at all
(checked via grep across `plugins/` and `claude/`).

Confidence: Confirmed — this is a direct read of the one skill that touches
this area, and a repo-wide grep confirming nothing else does.

### 5. Session/context hygiene

**Confirmed, mixed.** The skill/agent split itself is sound: the plugin's 16
skills and 3 agents (§3; grown from 5 skills and 1 agent when this audit
first shipped) are all on-demand (loaded only on invocation, per the
plugin-details always-on/on-invoke split in §3) rather than baked into
`CLAUDE.md`, which is
the correct default per the docs' own "Move instructions from CLAUDE.md to
skills" guidance. [`docs/contributing.md`'s "Why skills here don't declare
`allowed-tools`"](./contributing.md#why-skills-here-dont-declare-allowed-tools)
shows this was a deliberate design choice (weighing whether to add
`allowed-tools` per-skill vs. leaning on `settings.json`), not an accident.

The one thing genuinely mismatched between "always loaded" and "often
irrelevant" is `CLAUDE.md` itself, covered in depth in §2 — restated briefly
here because it's the primary finding for this section: 352 lines / ~6,200
tokens loaded into every session in every project, with a confirmed
~13%-of-file segment (TypeScript rules) irrelevant to this specific
Bash/Python repo on every one of those loads.

Confidence: Confirmed for the skill/agent architecture; Confirmed (same
evidence as §2) for the CLAUDE.md relevance-mismatch claim.

### 6. Effort / reasoning-level defaults

**Confirmed: no reasoning-effort knob exists anywhere in this repo.**
`grep -rln 'effort'` across `plugins/` and `claude/` returns exactly one
file, `pr-review-rubric/SKILL.md`, and every hit there
(`SKILL.md:7,150,220,226,527`) is the review-severity-taxonomy field
`**Effort:** Quick win | Heavy lift` — i.e., how much work a *reported
finding* is to fix, not a model reasoning-effort/thinking-budget setting.
There is no `/effort`, no `MAX_THINKING_TOKENS`, no thinking-budget
configuration anywhere in scope. This means there's also no *misconfigured*
effort knob to fix — the issue's "effort set higher than the task warrants"
concern doesn't apply here because the knob is never touched at all; every
invocation runs at whatever the ambient session default is.

Confidence: Confirmed (exhaustive grep, all 5 hits inspected).

### 7. Subscription vs. API usage tradeoffs

**Speculative, but grounded.** This repo's three workflows
(`.github/workflows/{shell,python,actionlint}.yml`) contain no direct
Claude or Anthropic invocation — they call pinned actions and `make`
targets (shellcheck/shfmt/bats/pytest/actionlint), and grepping all three
for "claude"/"anthropic" turns up nothing but a comment referencing the
CLAUDE.md convention (`shell.yml:12`), not an actual invocation. That
establishes no *direct* call; it doesn't rule out one of the pinned actions
or `make` targets shelling out to Claude indirectly, which this audit
didn't trace.

The exported skills are a different story: `pr-review-rubric` and
`pr-babysit` are both explicitly designed to be wired into *other* repos'
automation (`pr-babysit/SKILL.md:35-37`: "If you were invoked directly rather
than via a project-local skill that supplies [a snapshot command], stop and
say so — this skill cannot run standalone"; `pr-review-rubric` needs an
external `pr-review.md` orchestrator, per §3). Wherever a consuming repo
wires either of these into a GitHub Actions bot (as the rubric's own
"mention job"/"engage job"/"auto-review" terminology implies,
`SKILL.md:448-450`), that automation runs on API-key billing inside the
Action *if* the consuming Action authenticates with an API key — a repo
outside this one's scope, so this audit can't confirm which. Either way it's
a materially different cost model from the flat Claude subscription an
interactive session uses, and one where
`pr-review-rubric`'s ~8.8k-token on-invoke size (§3) and its documented
"re-verify everything on every push, no human in the loop" push-path
behavior (`SKILL.md:493-494`) directly multiply cost. This repo has no
visibility into how often that fires in any consuming repo, so this is
inference from the skill's own documented design, not a measurement.

Confidence: Speculative. The design intent (build for CI reuse elsewhere) is
Confirmed from the files; the actual billing path and invocation frequency
in any consuming repo is not observable from here.

## Ranked optimization opportunities

Ordered by (estimated effort to ship) vs. (plausible savings), highest
leverage first. None of these are applied in this PR — see the task
constraints; they're recommendations only.

1. **Trim `claude/CLAUDE.md` toward the 200-line guideline; move the two
   TypeScript sections into a TS-specific skill or a project-level snippet.**
   Effort: low (it's two contiguous, self-contained sections —
   `CLAUDE.md:95-109` and `:111-143` — with no cross-references from the
   rest of the file). Savings: ~48 lines (~13%) off the file that's loaded
   into literally every session on this machine, in every project,
   TypeScript or not; compounds across every non-TS session (this repo
   included) for as long as the content lives there. Confidence: Confirmed
   the content is there and is TS-specific; Speculative on exact token
   savings and how much it matters at ~800-1,000 tokens (small in absolute
   terms, but it's pure waste on every non-TS session and the file is
   already 76% over the docs' own size guideline, so trimming here is a
   concrete first cut toward that target rather than a one-off).

2. **Treat `claude/CLAUDE.md`'s current length as a standing budget, not
   just this one over-limit.** Effort: low to set up (a line-count check),
   ongoing discipline cost thereafter. Right now the file has taken on 13
   independent topic sections in under a week (48 commits since creation,
   §2) with no size ceiling enforced anywhere — `make check` has no CLAUDE.md
   line-count gate. Adding one (e.g., a `wc -l` assertion in the same spirit
   as the shell/coverage checks already in `Makefile`) would catch future
   growth before it re-crosses 200 lines, rather than requiring a periodic
   manual trim. Confidence: Confirmed no such gate currently exists (read of
   `Makefile`); the recommendation itself is a design suggestion, not a
   measured claim.

3. **Document why each agent is pinned to its model tier — one comment per
   agent, three agents now, not one.** Effort: trivial (a one-line comment
   in each of the three frontmatter blocks). Savings: none of the three
   overrides look miscalibrated against the docs' own criteria (§1) — opus
   for `adversarial-reviewer`'s cross-file reasoning, sonnet for
   `docs-staleness-checker`'s doc/code cross-referencing, haiku for
   `shell-script-reviewer`'s checklist — so this is a documentation gap, not
   a cost-savings opportunity. All three are invoked on-demand (not fanned
   out, not scheduled), so even if one were miscalibrated the *aggregate*
   savings would depend entirely on how often it's actually invoked —
   unknown from static analysis. Confidence: Confirmed all three overrides
   exist and are undocumented; Speculative on whether any is actually
   miscalibrated (each matches a legitimate use case for its tier per the
   docs' own criteria, so this is closer to "worth a one-line justification
   comment per agent" than "clear waste").

4. **If `pr-review-rubric` or `pr-babysit` get wired into a consuming
   repo's CI, confirm that automation runs the smallest model that holds
   review quality, and check the push-path re-verification cadence
   (`SKILL.md:493-494`) against actual push frequency before assuming it's
   cheap.** Effort: not actionable from this repo (the automation, if any,
   lives elsewhere) — this is a "check when you're there" flag, not a
   change to make here. Savings: potentially the largest single lever in
   this whole audit, since it's the one path in scope that plausibly runs
   on per-token API billing with automatic, no-human-in-the-loop retriggers
   — but entirely unmeasured from this repo. Confidence: Speculative
   throughout (§7) — flagged for the record, not sized.

5. **No action needed: fan-out, polling cadence, and effort-knob usage are
   already clean.** §3, §4, and §6 found no fan-out beyond a single subagent
   launch, a polling pattern that already implements dynamic long/short
   pacing, and zero reasoning-effort knobs set anywhere (so nothing is
   pinned too high). Restating this so the ranked list doesn't read as if
   everything needs fixing — three of the issue's seven investigation areas
   turned up nothing to change.

## Confidence summary

| Area | Verdict | Confidence |
|---|---|---|
| Model tier selection | Three overrides (opus/sonnet/haiku, one per agent), each plausibly matched to its task's reasoning complexity, all undocumented | Overrides: Confirmed. Justification: Speculative |
| Prompt caching / CLAUDE.md structure | Cache-friendly append shape; oversized (352 vs. 200-line guideline); ~13% TS-irrelevant-here content | Confirmed |
| Subagent/workflow fan-out | No fan-out in this repo (3 agents now, still one per caller, no parallel launch); rubric skill is large (~10.4k tok) and built for external reuse | In-repo facts: Confirmed. External impact: Speculative |
| Background task/polling | Clean — dynamic pacing already implemented, no fixed-interval polling found | Confirmed |
| Session/context hygiene | Skill/agent split is sound; CLAUDE.md is the one always-on/rarely-relevant mismatch | Confirmed |
| Effort/reasoning defaults | No knob exists anywhere in scope — nothing to miscalibrate | Confirmed |
| Subscription vs. API tradeoffs | Repo's own CI never touches Claude; exported skills are designed for external CI reuse where API billing likely applies | Speculative |
