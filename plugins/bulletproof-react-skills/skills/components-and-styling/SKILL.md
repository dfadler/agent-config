---
name: components-and-styling
description: |
  Component and styling conventions from bulletproof-react: colocate code
  near its usage, avoid nested render functions inside components, limit
  prop counts via composition over config, extract shared components into a
  library, and choose between fully-featured, headless, or copy-in-code
  component libraries and styling solutions (Chakra, MUI, Radix, Tailwind,
  shadcn, Storybook). Use when creating a new React component, reviewing one
  for API shape or bloat, splitting an over-large component, or picking a
  UI/styling library for a project.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🧱 Components And Styling

## Components Best Practices

#### Colocate things as close as possible to where it's being used

Place components, functions, styles, and state as close as possible to where you use them, rather than hoisting them up or centralizing them by default. This keeps the codebase more readable and easier to follow, and it improves runtime performance by shrinking the scope that re-renders on a state update.

#### Avoid large components with nested rendering functions

Don't add multiple rendering functions inside one component — it spirals out of control as the component grows. When a piece of UI can be treated as its own unit, extract it into a separate component instead of a nested render function.

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

#### Stay consistent

Keep your code style consistent — if components are named in PascalCase, name them that way everywhere. Set up linters and formatters in the project; they're what actually enforces this consistency rather than relying on everyone remembering the convention.

#### Limit the number of props a component is accepting as input

If a component is accepting too many props, split it into multiple components, or reach for composition via `children`/slots instead of piling on more configuration props.

[Composition Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/dialog/confirmation-dialog/confirmation-dialog.tsx)

#### Abstract shared components into a component library

On larger projects, build abstractions around shared components — it makes the application more consistent and easier to maintain. Identify actual repetition before you create an abstraction, so you don't lock in the wrong one.

[Component Library Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/button/button.tsx)

Wrap third-party components too, adapting them to the application's needs. It makes it easier to change the underlying implementation later without touching every call site across the app.

[3rd Party Component Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/link/link.tsx)

## Component libraries

Every project needs common UI pieces — modals, tabs, sidebars, menus. Reach for an existing, battle-tested component library instead of building these from scratch.

#### Fully featured component libraries:

These ship with their components fully styled.

- [Chakra UI](https://chakra-ui.com/) - great library with great developer experience, allows very fast prototyping with decent design defaults. Plenty of components that are very customizable and flexible with accessibility already configured out of the box.

- [AntD](https://ant.design/) - another great component library that has a lot of different components. Best suitable for creating admin dashboards. However, it might be a bit difficult to change the styles in order to adapt them to a custom design.

- [MUI](https://mui.com/material-ui/) - the most popular component library for React. Has a lot of different components. Can be used as a styled solution by implementing Material Design or as unstyled headless component library.

- [Mantine](https://mantine.dev/) - a modern react component library with a lot of components and hooks. It is very customizable and has a lot of features out of the box.

#### Headless component libraries:

These ship with their components unstyled. When you have a specific design system to implement, reach for a headless library instead of adapting a fully-styled one like MUI — it's easier to build your own styling on top of unstyled primitives than to strip an opinionated look off a styled library. Some good options:

- [Radix UI](https://www.radix-ui.com/)
- [Base UI](https://base-ui.com/)
- [Headless UI](https://headlessui.dev/)
- [react-aria](https://react-spectrum.adobe.com/react-aria/)
- [Ark UI](https://ark-ui.com/)
- [Reakit](https://reakit.io/)

## Styling Solutions

Pick one of these approaches to style a React application:

- [tailwind](https://tailwindcss.com/)
- [vanilla-extract](https://github.com/seek-oss/vanilla-extract)
- [Panda CSS](https://panda-css.com/)
- [CSS modules](https://github.com/css-modules/css-modules)
- [styled-components](https://styled-components.com/)
- [emotion](https://emotion.sh/docs/introduction)

NOTE: Keep React Server Components in mind — they require a zero-runtime styling solution.

With the rise of headless component libraries, another tier has emerged: predefined components that come with styling included, but delivered as code you copy in and customize rather than installed as a package.

- [ShadCN UI](https://ui.shadcn.com/)
- [Park UI](https://park-ui.com/)

## Storybook

Use [Storybook](https://storybook.js.org/) to develop and test components in isolation — treat it as a catalogue of every component your application uses. Check it before building a new component (something similar may already exist) and use it while building one to iterate without wiring up the full app around it.

[Storybook Story Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/button/button.stories.tsx)
