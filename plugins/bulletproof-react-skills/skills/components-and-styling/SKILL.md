---
name: components-and-styling
description: |
  Component and styling conventions from bulletproof-react: colocation,
  avoiding nested render functions, container/presentation separation, and
  composition-over-config for component APIs. Use when designing a new
  component or reviewing one for API shape and styling approach.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🧱 Components And Styling

## Components Best Practices

### Colocate things as close as possible to where it's being used

Place components, functions, styles, state, etc. as close as possible to where they're used. This keeps the codebase more readable and easier to understand, and it improves runtime performance by reducing redundant re-renders on state updates.

### Avoid large components with nested rendering functions

Don't nest multiple rendering functions inside a component — it gets out of control fast as the component grows. When a piece of UI can be considered a unit, extract it into a separate component instead.

```javascript
// this is very difficult to maintain as soon as the component starts growing
function Component() {
  function renderItems() {
    return <ul>...</ul>;
  }
  return <div>{renderItems()}</div>;
}

// extract it in a separate component
function Items() {
  return <ul>...</ul>;
}

function Component() {
  return (
    <div>
      <Items />
    </div>
  );
}
```

### Stay consistent

Keep code style consistent — for example, if components are named using PascalCase, apply that everywhere. Enforce this with linters and code formatters rather than relying on manual discipline.

### Limit the number of props a component is accepting as input

If a component is accepting too many props, split it into multiple components or use composition via children or slots instead.

[Composition Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/dialog/confirmation-dialog/confirmation-dialog.tsx)

### Abstract shared components into a component library

For larger projects, build abstractions around shared components — it makes the application more consistent and easier to maintain. Identify actual repetitions before creating an abstraction, to avoid abstracting the wrong thing.

[Component Library Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/button/button.tsx)

Wrap 3rd party components too, adapting them to the application's needs. This makes it easier to change the underlying implementation later without affecting the rest of the application.

[3rd Party Component Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/link/link.tsx)

## Component libraries

Every project needs some UI components — modals, tabs, sidebars, menus, etc. Reach for an existing, battle-tested component library instead of building these from scratch.

### Fully featured component libraries:

These come with their components fully styled.

- [Chakra UI](https://chakra-ui.com/) - great developer experience, allows very fast prototyping with decent design defaults. Plenty of components that are very customizable and flexible with accessibility already configured out of the box.

- [AntD](https://ant.design/) - a lot of different components. Best suited for creating admin dashboards. However, it might be a bit difficult to change the styles to adapt them to a custom design.

- [MUI](https://mui.com/material-ui/) - the most popular component library for React. Has a lot of different components. Can be used as a styled solution by implementing Material Design or as an unstyled headless component library.

- [Mantine](https://mantine.dev/) - a modern React component library with a lot of components and hooks. Very customizable with a lot of features out of the box.

### Headless component libraries:

These come with their components unstyled. When implementing a specific design system, prefer headless components over adapting a fully featured library like Material UI to fit — it's easier and produces a better result. Good options:

- [Radix UI](https://www.radix-ui.com/)
- [Base UI](https://base-ui.com/)
- [Headless UI](https://headlessui.dev/)
- [react-aria](https://react-spectrum.adobe.com/react-aria/)
- [Ark UI](https://ark-ui.com/)
- [Reakit](https://reakit.io/)

## Styling Solutions

Several good options exist for styling a React application:

- [tailwind](https://tailwindcss.com/)
- [vanilla-extract](https://github.com/seek-oss/vanilla-extract)
- [Panda CSS](https://panda-css.com/)
- [CSS modules](https://github.com/css-modules/css-modules)
- [styled-components](https://styled-components.com/)
- [emotion](https://emotion.sh/docs/introduction)

NOTE: Keep React Server Components in mind — they require a zero-runtime styling solution.

With the rise of headless component libraries, another tier has emerged: predefined, styled components delivered as code you copy and customize, rather than as an installed package.

- [ShadCN UI](https://ui.shadcn.com/)
- [Park UI](https://park-ui.com/)

## Storybook

Use [Storybook](https://storybook.js.org/) to develop and test components in isolation — treat it as a catalogue of every component the application uses. It's valuable both for development and for discoverability of existing components.

[Storybook Story Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/button/button.stories.tsx)
