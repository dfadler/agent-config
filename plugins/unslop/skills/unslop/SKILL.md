---
name: unslop
description: |
  Rewrite prose to remove AI-writing patterns (filler, stock vocabulary, em dashes,
  chatbot phrases, mannered or over-compressed sentences) while keeping the meaning and tone.
  Runs only when the user invokes /unslop:unslop on text or a file. Pass `check` to list the
  matched rule ids without rewriting. Not for code, logs or quoted text.
disable-model-invocation: true
metadata:
  version: "1.0.0"
---

# Unslop

Adapted from [`pstack/skills/unslop`](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md)
in cursor/plugins (MIT, copyright Lauren Tan; see `LICENSE` in the plugin root).

## Contract

- **Input:** prose from the user's message or a file they name. `check` as the first
  argument selects check-only mode.
- **Output:** for pasted text, the rewritten text only, with meaning and tone unchanged: no
  list of rules, no list of removed words, no summary. For a named file, the edited file plus one
  line of the rule ids fixed. In check-only mode, only lines of the form `U7: "pivotal"`
  (rule id, colon, quoted match), with no introduction and no rewrite.
- **Does not:** touch code blocks, inline code, logs, quoted material, or text the user
  did not hand over. It does not change facts, numbers, names or links.

## Steps

1. Read the text and note its tone (formal doc, PR body, chat message).
2. Scan for each pattern below. Collect every match with its rule id.
3. In check-only mode, print the matches and stop.
4. Otherwise rewrite each match, then re-scan the result until no rule matches.
5. When a file was named, edit that file in place and report the rule ids fixed.
   When text was pasted, return the rewritten text and nothing else. The one exception is a
   missing figure (see Example): add a single question after the rewrite asking for it.

Rule ids are stable and other files cite them. A removed rule leaves a gap.

## Patterns

### Content

- **U3 trailing -ing phrases.** "highlighting...", "ensuring...", "showcasing...". Delete, or state the concrete effect.
- **U5 vague attribution.** "Experts believe", "Industry reports suggest". Name the source or delete.

### Language

- **U7 stock vocabulary.** Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore, vibrant. Use the plain word.
- **U8 inflated "is".** "serves as", "stands as", "boasts", "features". Write "is" or "has".
- **U9 "not just X, but Y".** State the point directly.
- **U10 forced triples.** Use the natural number of items.
- **U11 synonym cycling.** Pick one term for a thing and repeat it.
- **U12 false ranges.** "from X to Y" where X and Y are not on one scale. List the topics.

### Style

- **U13 dashes.** Write no em dash and no en dash. End the sentence or use a comma. A hyphen is for compound words only.
- **U14 mid-sentence colons.** A colon introduces a list or an example. Rewrite a colon that connects two clauses.
- **U15 bold overuse.** Bold is for the one thing the reader must not miss, not for every proper noun.
- **U16 inline-header lists.** A bold label that restates its line ("**Performance:** Performance improved") becomes prose. A bold lead-in that names the item and is followed by new detail is fine.
- **U17 title case headings.** Use sentence case.
- **U18 decorative emoji.** Remove them from headings and bullets.
- **U19 curly quotes.** Use straight quotes.

### Communication artifacts

- **U20 chatbot phrases.** "I hope this helps!", "Let me know if...", "Certainly!". Delete.
- **U22 sycophancy.** "Great question!", "You're absolutely right!". Answer directly.

### Filler

- **U23 filler phrases.** "In order to" becomes "To". "Due to the fact that" becomes "Because". Delete "It is important to note that".
- **U24 stacked hedges.** "could potentially possibly" becomes "may".
- **U25 generic conclusions.** "The future looks bright." State a specific plan or fact.

### Jargon

- **U26 abstract metaphor nouns.** substrate, wedge, vector, locus, nexus, bedrock, paradigm, modality, north star, flywheel, "API surface", metaphorical scaffolding, harness, primitive or ratchet, "gold-plating", "evacuate" for moving code. Use the concrete word (base, add, way, move out, last phase).

### Plain speech

- **U27 feeling instead of mechanism.** "SQL you can read" names a feeling. Name the mechanism or a number: "`.toSQL()` returns the exact string sent to the database". If a sentence cannot become a concrete instruction, fact or number, cut it. If it could appear unchanged in another project's docs, cut it.
- **U28 dense sentences.** Split a sentence the reader must reread. One idea each.
- **U29 passive voice.** Name the actor: "queries are validated" becomes "the compiler validates queries". Keep the passive only when the actor is unknown or irrelevant.
- **U30 adverbs.** Use a stronger verb or the measured number: "significantly improves" becomes the delta.
- **U31 fancy words.** utilize and leverage become use, facilitate becomes help, numerous becomes many, "in the event that" becomes if.
- **U32 mannered prose.** Aphorisms, effect-fragments, personified code, figurative verbs ("rides along", "stands on"). Say the literal thing.
- **U33 over-compression.** Dropped articles, verbless fragments, arrows and unexplained abbreviations. "Parser rejects bad date, exit 2" becomes "The parser rejects a bad date and exits with code 2."

## Example

Before: "Additionally, this pivotal change serves as a testament to our commitment, ensuring a robust, seamless landscape."
After: "This change makes the build faster. CI now finishes in 4 minutes instead of 9."

The rewrite replaces the vague claim with a number the author must supply. When the source has no
number, write the rewrite without a figure or a placeholder such as `[X%]`, then ask the user
for the number in one question.
