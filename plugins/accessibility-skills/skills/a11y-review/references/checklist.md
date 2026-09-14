# WCAG 2.2 checklist (source material)

Adapted from [The A11Y Project's checklist](https://www.a11yproject.com/checklist/)
(Apache License 2.0). See `../../../NOTICE.md` for provenance. Each item maps to a
WCAG 2.2 success criterion (SC) — cite the SC number in findings, not just the
checklist wording.

Grep this file for a keyword (`color`, `label`, `heading`, `focus`, …) rather than
reading it end to end when reviewing a specific concern.

## Content

- Plain language; avoid idioms and complicated metaphors — [3.1.5 Reading Level](https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html)
- `button`, `a`, and `label` element content is unique and descriptive — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- Text alignment matches the language's direction (left for LTR, right for RTL) — [1.4.8 Visual Presentation](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html)

## Global code

- HTML validates — [4.1.1 Parsing](https://www.w3.org/WAI/WCAG22/Understanding/parsing.html)
- `lang` attribute on `html` — [3.1.1 Language of Page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html)
- Unique `title` per page/view — [2.4.2 Page Titled](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html)
- Viewport zoom is not disabled — [1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
- Landmark elements mark content regions — [4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)
- Linear content flow — [2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)
- No `autofocus` attribute — [2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)
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
- Only one `h1` per page/view — [2.4.6 Headings or Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)
- Headings are in a logical sequence — [2.4.6 Headings or Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)
- No skipped heading levels — [2.4.6 Headings or Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)

## Lists

- List content uses `ol`/`ul`/`dl` — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)

## Controls

- Links use the `a` element — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- Links are recognizable as links (not color-only) — [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- Controls have `:focus` states — [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)
- Buttons use the `button` element — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- A skip link exists and is visible when focused — [2.4.1 Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html)
- Links that open a new tab/window are identified — [G201](https://www.w3.org/WAI/WCAG22/Techniques/general/G201)

## Tables

- Tabular data uses the `table` element — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- Table headers use `th` with appropriate `scope` — [4.1.1 Parsing](https://www.w3.org/WAI/WCAG22/Understanding/parsing.html)
- Tables have a `caption` — [2.4.6 Headings or Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)

## Forms

- Every input is associated with a `label` — [3.2.2 On Input](https://www.w3.org/WAI/WCAG22/Understanding/on-input.html)
- `fieldset`/`legend` used where appropriate — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- Inputs use `autocomplete` where appropriate — [1.3.5 Identify Input Purpose](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html)
- Form errors are listed above the form after submission — [3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)
- Error messaging is associated with its input — [3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)
- Error/warning/success states aren't color-only — [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)

## Media

- Media does not autoplay — [1.4.2 Audio Control](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html)
- Media controls use appropriate markup — [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- All media can be paused — [2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)

## Video

- Captions are present — [1.2.2 Captions](https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded.html)
- No seizure triggers — [2.3.1 Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)

## Audio

- Transcripts are available — [1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)

## Appearance

- Content works in specialized browsing modes (e.g. forced-colors) — [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- Text remains usable at 200% zoom — [1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
- Good proximity between related content — [1.3.3 Sensory Characteristics](https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html)
- Color isn't the only way information is conveyed — [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- Instructions aren't visual/audio-only — [1.3.3 Sensory Characteristics](https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html)
- Simple, straightforward, consistent layout — [1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)

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
- Sufficient space between interactive items — [2.4.1 Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html)
