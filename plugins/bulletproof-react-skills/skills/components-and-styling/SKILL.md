---
name: components-and-styling
description: |
  Component and styling conventions from bulletproof-react: colocation,
  avoiding nested render functions, container/presentation separation, and
  composition-over-config for component APIs. Covers when to reach for a
  fully-styled vs. headless component library, which styling solution fits
  a given setup (including React Server Components constraints), and using
  Storybook for isolated component development. Use this when designing a
  new component's API, reviewing a component for prop bloat or nested
  render functions, choosing a component library or styling approach for a
  project, or when a request looks like "this component is taking too many
  props, how should I split it up," "what component library should I use
  for this dashboard," or "where should I put this piece of state/style so
  it doesn't cause unnecessary re-renders."
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🧱 Components And Styling

## Components Best Practices

### Colocate things as close as possible to where it's being used

Keep components, functions, styles, state, etc. as close as possible to where they are being used. Do this because it makes the codebase more readable and easier to understand, and it improves application performance by reducing redundant re-renders on state updates.

### Avoid large components with nested rendering functions

Do not add multiple rendering functions inside a component — this gets out of control quickly as the component grows. Instead, when a piece of UI can be considered a unit, extract it into a separate component.

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

Keep code style consistent — for example, if components are named using pascal case, name them that way everywhere. Set up linters and code formatters in the project, since they enforce most of this consistency automatically.

### Limit the number of props a component is accepting as input

If a component accepts too many props, split it into multiple components or use composition via children or slots instead.

[Composition Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/dialog/confirmation-dialog/confirmation-dialog.tsx)

### Abstract shared components into a component library

For larger projects, build abstractions around all shared components — this keeps the application consistent and easier to maintain. Identify repetitions before creating the components, so as not to build the wrong abstraction.

[Component Library Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/button/button.tsx)

Wrap 3rd party components too, adapting them to the application's needs. This makes it easier to change the underlying implementation later without affecting the application's functionality.

[3rd Party Component Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/link/link.tsx)

## Component libraries

Every project needs some UI components such as modals, tabs, sidebars, menus, etc. Reach for an existing, battle-tested component library instead of building these from scratch.

### Fully featured component libraries:

These component libraries come with their components fully styled.

- [Chakra UI](https://chakra-ui.com/) - great library with great developer experience, allows very fast prototyping with decent design defaults. Plenty of components that are very customizable and flexible with accessibility already configured out of the box.

- [AntD](https://ant.design/) - another great component library that has a lot of different components. Best suitable for creating admin dashboards. However, it might be a bit difficult to change the styles in order to adapt them to a custom design.

- [MUI](https://mui.com/material-ui/) - the most popular component library for React. Has a lot of different components. Can be used as a styled solution by implementing Material Design or as unstyled headless component library.

- [Mantine](https://mantine.dev/) - a modern react component library with a lot of components and hooks. It is very customizable and has a lot of features out of the box.

### Headless component libraries:

These component libraries come with their components unstyled. If there is a specific design system to implement, reach for headless components over adapting a fully featured component library such as Material UI. Some good options are:

- [Radix UI](https://www.radix-ui.com/)
- [Base UI](https://base-ui.com/)
- [Headless UI](https://headlessui.dev/)
- [react-aria](https://react-spectrum.adobe.com/react-aria/)
- [Ark UI](https://ark-ui.com/)
- [Reakit](https://reakit.io/)

## Styling Solutions

There are multiple ways to style a react application. Some good options are:

- [tailwind](https://tailwindcss.com/)
- [vanilla-extract](https://github.com/seek-oss/vanilla-extract)
- [Panda CSS](https://panda-css.com/)
- [CSS modules](https://github.com/css-modules/css-modules)
- [styled-components](https://styled-components.com/)
- [emotion](https://emotion.sh/docs/introduction)

NOTE: Keep React Server Components in mind. Server Components themselves require a zero-runtime styling solution; runtime CSS-in-JS can still work for a Client Component behind a supported Server/Client boundary, so pick your styling solution based on where in the tree it needs to run, not as a blanket rule for the whole app.

With the rise of headless component libraries, another tier of component libraries has emerged where predefined components are provided with styling solutions included, but instead of being installed as a package, they are provided as code that can be customized and styled as needed.

- [ShadCN UI](https://ui.shadcn.com/)
- [Park UI](https://park-ui.com/)

## Storybook

Reach for [Storybook](https://storybook.js.org/) to develop and test components in isolation. Treat it as a catalogue of every component the application uses — useful both for development and for making existing components discoverable before building new ones.

[Storybook Story Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/button/button.stories.tsx)
