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

**Confirmed.** Exactly one `model:` override exists anywhere in the plugin:
`plugins/dfadler-agent-config/agents/adversarial-reviewer.md:12` sets
`model: opus`. No other agent or skill sets a model. This is also the *only*
subagent defined in the whole repo (`plugins/dfadler-agent-config/agents/`
has one file), so there's no fan-out of cheap-task-on-expensive-model to find
— the finding is narrower than the issue anticipated: there's one override,
and it's arguably the right kind of task for it.

The official guidance: "Sonnet handles most coding tasks well and costs less
than Opus. Reserve Opus for complex architectural decisions or multi-step
reasoning... For simple subagent tasks, specify `model: haiku` in your
subagent configuration." ([code.claude.com/docs/en/costs](https://code.claude.com/docs/en/costs))
`adversarial-reviewer.md` is explicitly a "hunt for hidden bugs, security
flaws, concurrency issues... follow calls into their definitions and check
the callers of anything you touch" agent (`adversarial-reviewer.md:19-51`) —
that's multi-step, cross-file reasoning, which is the exact class Opus is
reserved for, not the "simple subagent task" class the docs point at Haiku.
The file has no comment explaining *why* Opus was chosen, so the choice reads
as plausible-by-task-shape rather than a documented decision.

Confidence: model-tier fact is Confirmed (grep + read). Whether Opus is
*necessary* here vs. Sonnet-with-escalation is Speculative — that would need
a real before/after comparison of review quality on the same diffs, which
this audit can't run.

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
in 4 days. Within-session prompt caching (the thing that actually matters for
cost — cache lifetime is "an hour on a subscription... five minutes by
default" on API/usage-credits per the same docs page) isn't hurt by
cross-day file changes, since a session's cache window is much shorter than a
day regardless. The real cost of this churn rate is different from a caching
problem: it means whichever session is actively editing `CLAUDE.md` is, by
construction, generating one commit-sized diff read/write per iteration, and
each of the 48 commits is a full `git diff`/read of a file that keeps
growing — a self-inflicted, compounding editing cost distinct from the
caching question the issue asked about.

Confidence: line/byte counts and churn commit counts are Confirmed
(direct tool output). The claim that 352 lines meaningfully raises
per-session cost vs. a 200-line file, and that the TypeScript sections are
"waste" in *this* repo specifically, are Confirmed as facts about this
repo's content but Speculative as a claim about aggregate cost impact across
this user's *other* (TS-containing) repos, where the same content is fully
relevant every session.

### 3. Subagent / workflow fan-out costs

**Confirmed: no problematic fan-out found in this repo.**
`claude/commands/adversarial-review.md` launches exactly one subagent
(`dfadler-agent-config:adversarial-reviewer`, `adversarial-review.md:5`) per
invocation — no parallel fan-out to audit here. The issue's own text names
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
not estimated by hand) reports:

```
Projected token cost
  Always-on:   ~1,243 tok   added to every session

Per-component (rounded)
  component             always-on  on-invoke
  gh-attach-image            ~210      ~1.5k
  pr-visual-capture          ~160      ~4.1k
  pr-babysit                 ~230      ~3.5k
  pr-review-rubric           ~250      ~8.8k
  detached-terminal          ~270      ~2.3k
  adversarial-reviewer       ~130       ~880
```

`pr-review-rubric` is the single most expensive on-invoke skill in the
plugin at ~8.8k tokens per load — consistent with it being the longest file
in scope (576 lines, `wc -l`). Since the rubric documents a "push-path
re-check... re-verifying your own open threads on every push with no human
in the loop" (`SKILL.md:493-494`) as part of its intended usage pattern in a
consuming repo, an automation that reloads this skill fresh on every push to
every open PR pays that ~8.8k-token cost per reload, per PR, per push — that
compounds fast in a busy repo, but the actual reload frequency lives in a
CI config this repo doesn't contain, so the multiplier is unknown from here.

Always-on cost across the whole plugin (~1,243 tokens, all 5 skill
descriptions) is small in absolute terms — for comparison, it's about a
fifth of `CLAUDE.md`'s own ~6,200-token footprint (§2) — and is the
unavoidable cost of skill-triggering descriptions; skills are already the
correct on-demand mechanism here (see §5).

Confidence: the plugin-details numbers are Confirmed (tool output, this
session, this checkout). The claim about compounding cost from repeated
push-path reloads in a consuming repo is Speculative — no such repo's CI
config is in scope here.

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

**Confirmed, mixed.** The skill/agent split itself is sound: five skills plus
one agent are all on-demand (loaded only on invocation, per the plugin-details
always-on/on-invoke split in §3) rather than baked into `CLAUDE.md`, which is
the correct default per the docs' own "Move instructions from CLAUDE.md to
skills" guidance. `README.md:170-181` shows this was a deliberate design
choice (weighing whether to add `allowed-tools` per-skill vs. leaning on
`settings.json`), not an accident.

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

**Speculative, but grounded.** This repo itself defines no CI workflow that
invokes Claude programmatically — `.github/workflows/{shell,python,actionlint}.yml`
are conventional CI (shellcheck/shfmt/bats/pytest/actionlint), and grepping
all three for "claude"/"anthropic" turns up nothing except a comment
referencing the CLAUDE.md convention (`shell.yml:140`), not an actual
invocation. So *this repo's own* CI runs entirely outside any Claude billing
path.

The exported skills are a different story: `pr-review-rubric` and
`pr-babysit` are both explicitly designed to be wired into *other* repos'
automation (`pr-babysit/SKILL.md:35-37`: "If you were invoked directly rather
than via a project-local skill that supplies [a snapshot command], stop and
say so — this skill cannot run standalone"; `pr-review-rubric` needs an
external `pr-review.md` orchestrator, per §3). Wherever a consuming repo
wires either of these into a GitHub Actions bot (as the rubric's own
"mention job"/"engage job"/"auto-review" terminology implies,
`SKILL.md:448-450`), that automation almost certainly runs on API-key
billing inside the Action, not the flat Claude subscription an interactive
session uses — a materially different, per-token cost model, and one where
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

3. **Document (or reconsider) why `adversarial-reviewer` is pinned to
   Opus.** Effort: trivial (a one-line comment in the frontmatter, or a
   swap to Sonnet with an escalation path). Savings: per-invocation, Opus
   vs. Sonnet is a meaningful per-token multiplier, but this agent is
   invoked on-demand (not fanned out, not scheduled) so the *aggregate*
   savings depend entirely on how often `/adversarial-review` actually gets
   run — unknown from static analysis. Confidence: Confirmed the override
   exists and is undocumented; Speculative on whether it's actually
   miscalibrated (the task shape — deep cross-file, security/concurrency
   reasoning — is a legitimate Opus use case per the docs' own criteria, so
   this is closer to "worth a one-line justification comment" than "clear
   waste").

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
| Model tier selection | One override (Opus), plausibly justified, undocumented | Override: Confirmed. Justification: Speculative |
| Prompt caching / CLAUDE.md structure | Cache-friendly append shape; oversized (352 vs. 200-line guideline); ~13% TS-irrelevant-here content | Confirmed |
| Subagent/workflow fan-out | No fan-out in this repo; rubric skill is large (~8.8k tok) and built for external reuse | In-repo facts: Confirmed. External impact: Speculative |
| Background task/polling | Clean — dynamic pacing already implemented, no fixed-interval polling found | Confirmed |
| Session/context hygiene | Skill/agent split is sound; CLAUDE.md is the one always-on/rarely-relevant mismatch | Confirmed |
| Effort/reasoning defaults | No knob exists anywhere in scope — nothing to miscalibrate | Confirmed |
| Subscription vs. API tradeoffs | Repo's own CI never touches Claude; exported skills are designed for external CI reuse where API billing likely applies | Speculative |
