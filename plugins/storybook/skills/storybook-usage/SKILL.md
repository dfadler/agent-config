---
name: storybook-usage
description: |
  Use when writing or editing a Storybook story (`*.stories.*`, CSF meta, args, play
  function), starting or building Storybook, running play-function tests, or confirming a
  story renders. Returns the story shape, the commands, and the check that proves the story
  works. Not for recording a play function as video (use `playwright:playwright`),
  screenshots (use `screen-capture:capture`) or unit tests with no Storybook (use
  `vitest:test-conventions`).
metadata:
  version: "1.0.0"
---

# Working with Storybook

## Contract

- **Input:** a project that uses Storybook and a task: write or edit a story, start or build
  Storybook, run interaction tests, or verify a story.
- **Output:** the story file or commands, plus the result of one check that the story renders.
- **Does not:** install Storybook, upgrade it across majors, or record video or screenshots.

## Read the installed version first

Storybook's import paths and test tooling differ between majors. Read the `storybook` version
in `package.json` and the `stories` globs in `.storybook/main.*` before writing anything, and
copy the import style of a neighbouring story file.

## Write a story

A story file is a CSF file: a default export (the meta) and one named export per story
([Writing stories](https://storybook.js.org/docs/writing-stories)).

```ts
import type { Meta, StoryObj } from '@storybook/<framework>';
import { <ComponentName> } from './<ComponentName>';

const meta = {
  component: <ComponentName>,
} satisfies Meta<typeof <ComponentName>>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { label: 'Button' },
};
```

- Name the file so a `stories` glob matches it. The documented pattern is
  `*.stories.@(js|jsx|mjs|ts|tsx)`
  ([stories config](https://storybook.js.org/docs/api/main-config/main-config-stories)).
- The meta needs a `title` or a `component`; name each story export in UpperCamelCase
  (Writing stories, above).
- Pass inputs through `args`. Reuse another story's args with `...Primary.args`.
- Import `Meta` and `StoryObj` from the framework package the project uses, never from a
  guess.

## Add a play function

A `play` function runs after the story renders and drives it like a user
([Interaction tests](https://storybook.js.org/docs/writing-tests/interaction-testing)).

```ts
import { expect, fn } from 'storybook/test';

export const Submits: Story = {
  args: { onSubmit: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /submit/i }));
    await expect(args.onSubmit).toHaveBeenCalled();
  },
};
```

- `await` every `userEvent` and `expect` call.
- Query `canvas` by role first and by test id last.
- Group steps with `await step('<label>', async () => { ... })`.

## Run and build

- `storybook dev -p <port>` starts the dev server; add `--ci` to skip prompts and the
  browser, and `--exact-port` to fail when the port is taken.
- `storybook build -o <dir>` writes the static site; `build` has no `--ci` flag.
  Source: [CLI options](https://storybook.js.org/docs/api/cli-options).
- Start the dev server with `run_in_background` and stop it when done.

## Run play functions as tests

Storybook's own docs recommend the Vitest addon on Vite-based frameworks and say the
[test runner](https://storybook.js.org/docs/writing-tests/integrations/test-runner) has been
superseded by it. Use whichever the project already has: look for `@storybook/addon-vitest`
or `@storybook/test-runner` in `package.json`.

- The test runner expects Storybook on port 6006 by default; point it elsewhere with
  `--url`, e.g. `test-storybook --url <storybook-url>`.
- Add neither tool unasked.

## Verify a story renders

A story that type-checks can still fail at render. Finish with one of:

1. The project's play-function test command, run on the story.
2. Open `iframe.html?id=<story-id>&viewMode=story` on the running Storybook and confirm no
   error overlay. Take the story id from the URL after selecting the story in the UI.

State which check you ran and its result. For video or screenshots hand off to
`playwright:playwright` or `screen-capture:capture`.
