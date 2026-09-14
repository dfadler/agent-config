# WCAG 2.2 checklist (source material)

Adapted from [The A11Y Project's checklist](https://www.a11yproject.com/checklist/)
(Apache License 2.0). See `../../../NOTICE.md` for provenance. Each item maps to a
WCAG 2.2 success criterion (SC) — cite the SC number in findings, not just the
checklist wording.

Grep this file for a keyword (`color`, `label`, `heading`, `focus`, …) rather than
reading it end to end when reviewing a specific concern.

## Content

- Plain language; avoid idioms and complicated metaphors — [3.1.5 Reading Level](https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html)
- Link text describes its destination/purpose on its own (avoid "click here") — [2.4.4 Link Purpose (In Context)](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html)
- Button and form-control text/labels are descriptive, not generic ("Button 1") — [2.4.6 Headings and Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html), [3.3.2 Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)
- Text alignment matches the language's direction (left for LTR, right for RTL) — [1.4.8 Visual Presentation](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html)

## Global code

- HTML validates — good practice for reliable assistive-tech parsing, but note: WCAG 2.2 removed SC 4.1.1 Parsing entirely (modern browsers/AT already error-correct malformed markup), so don't cite it as a WCAG 2.2 SC — treat this as advisory, not a numbered-SC finding
- `lang` attribute on `html` — [3.1.1 Language of Page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html)
- Unique `title` per page/view — [2.4.2 Page Titled](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html)
- Viewport zoom is not disabled — [1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
- Landmark elements mark content regions — [4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)
- Linear content flow — [2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)
- `autofocus`, when present, doesn't disrupt the page's logical focus order — [2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html). `autofocus` itself isn't a WCAG violation; it's a conditional check — flag its presence as ◐ (confirm the resulting order is still logical), never as an automatic ● failure
- Session timeouts can be extended — [2.2.1 Timing Adjustable](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html)
- No `title`-attribute tooltips — [4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)

## Keyboard

- Visible focus style on every keyboard-reachable interactive element — [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)
- Keyboard focus order matches the visual layout — [1.3.2 Meaningful Sequence](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html)
- No invisible focusable elements — [2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)

## Images

- Every `img` has an `alt` attribute — [1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)
- Decorative images use a null (`alt=""`) value — [1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)
- Complex images (charts, graphs, maps) get a text alternative — [1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)
- Images containing text include that text in the `alt` description — [1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)

## Headings

- Heading elements introduce content sections — [2.4.6 Headings or Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)
- Heading text describes the topic or purpose of what follows — [2.4.6 Headings or Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)

A single `h1`, a fully sequential heading rank, and "no skipped levels" are common
best-practice heuristics, not standalone WCAG failures on their own — 2.4.6 only
requires that headings/labels describe topic or purpose, not a specific document
outline shape (W3C's own guidance permits skipping ranks when closing a
subsection). Note a rank skip or a second `h1` as a ◐ structural observation when
it makes the page's organization genuinely hard to follow, not as an automatic ●
failure — and remember that component source may only show a fragment of the
final page's heading hierarchy, so a skip visible in isolation may not be one in
context.

## Lists

- List content uses `ol`/`ul`/`dl` — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)

## Controls

- Links use the `a` element — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- Links are recognizable as links (not color-only) — [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- Controls have `:focus` states — [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)
- Buttons use the `button` element — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- A skip link exists and is visible when focused — [2.4.1 Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html)

## Tables

- Tabular data uses the `table` element — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- Table headers use `th` with appropriate `scope` — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- Tables have a `caption` — [2.4.6 Headings or Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)

## Forms

- Every input is associated with a `label` — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html), [3.3.2 Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)
- `fieldset`/`legend` used where appropriate — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- Inputs use `autocomplete` where appropriate — [1.3.5 Identify Input Purpose](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html)
- Form errors are listed above the form after submission — [3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)
- Error messaging is associated with its input — [3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)
- Error/warning/success states aren't color-only — [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)

## Media

- Audio that autoplays for more than 3 seconds has an independent pause/stop or
  volume control (audio that stops within 3 seconds, or doesn't autoplay at all,
  is fine) — [1.4.2 Audio Control](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html)
- Media controls use appropriate markup — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- Moving/auto-updating media (not just audio) can be paused, stopped, or hidden — [2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- Media controls are themselves operable by keyboard — [2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)

## Video

- Captions are present — [1.2.2 Captions](https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded.html)
- No seizure triggers — [2.3.1 Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)

## Audio

- A transcript is available for prerecorded audio-only content — [1.2.1 Audio-only and Video-only (Prerecorded)](https://www.w3.org/WAI/WCAG22/Understanding/audio-only-and-video-only-prerecorded.html)

## Appearance

- Content works in specialized browsing modes (e.g. forced-colors) — [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- Text remains usable at 200% zoom — [1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
- Color isn't the only way information is conveyed — [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- Instructions that rely only on shape, position, size, or sound (not on their
  text) also have a text-based way to identify the thing they refer to (e.g. not
  just "press the round button") — [1.3.3 Sensory Characteristics](https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html)

## Animation

- Animations are subtle, don't flash excessively — [2.3.1 Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)
- Background video can be paused — [2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- Animation obeys `prefers-reduced-motion` — [2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

## Color contrast

- Normal-sized text meets contrast minimum — [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- Large-sized text meets contrast minimum — [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- Icons meet non-text contrast — [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- Input borders (text input, radio, checkbox, etc.) meet non-text contrast — [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- Text overlapping images/video meets contrast — [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- Custom `::selection` colors meet contrast — [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

## Mobile and touch

- Site works in any orientation — [1.3.4 Orientation](https://www.w3.org/WAI/WCAG22/Understanding/orientation.html)
- No horizontal scrolling — [1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- Button/link icons are easy to activate (target size) — [2.5.5 Target Size (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
- Small interactive targets have sufficient size or spacing from neighboring
  targets (subject to 2.5.8's own exceptions — inline text links, targets the
  author doesn't control, essential/legally-required sizing) — [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## Advisory (not standalone WCAG failures)

These are real design/authoring guidance, but none of them are on their own a
numbered WCAG success-criterion failure — either because they're best-practice
heuristics behind a criterion that requires something looser (heading structure,
proximity, layout), or because the source is a non-normative technique (G201)
rather than a success criterion. Report a finding here as ◐ at most, with the
reasoning spelled out, never as an automatic ●.

- Links that open a new tab/window are identified — technique [G201](https://www.w3.org/WAI/WCAG22/Techniques/general/G201), not itself a success criterion; relevant to [3.2.5 Change on Request](https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html) only if the context change is otherwise unexpected
- Good proximity between related content, and a simple/consistent layout — general design heuristics that support [1.3.3 Sensory Characteristics](https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html)-style clarity but aren't themselves that SC's failure condition; don't cite a numbered SC for these unless the specific instance also violates one directly
