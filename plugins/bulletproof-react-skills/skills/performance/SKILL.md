---
name: performance
description: |
  Performance conventions from bulletproof-react: code splitting,
  component/state update optimization, list virtualization, image
  optimization, and bundle analysis. Use when a React app feels slow or before
  shipping a feature that renders large lists or heavy assets.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🚄 Performance

## Code Splitting

Split production JavaScript into smaller files so the app downloads only what a given screen needs, instead of one monolithic bundle upfront.

Split at the routes level by default: load only what's essential for the initial screen, and lazily fetch the rest as the user navigates. Don't over-split — splitting too granularly adds enough extra requests to fetch all the chunks that it can net out slower than a coarser split. Target critical, high-value boundaries rather than splitting everything.

[Code Splitting Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/app/router.tsx)

## Component and state optimizations

- Don't put everything in a single state — that triggers unnecessary re-renders across components that don't care about most of it. Split global state into multiple states scoped to where each piece is actually used.

- Keep state as close as possible to where it's used, so updating it doesn't re-render components that don't depend on it.

- When state is initialized by an expensive computation, pass the state initializer as a function, not a called value — otherwise the expensive function reruns on every render even though the state is only set once:

```javascript
// instead of this which would be executed on every re-render:
const [state, setState] = React.useState(myExpensiveFn());

// prefer this which is executed only once:
const [state, setState] = React.useState(() => myExpensiveFn());
```

- For state that tracks many elements at once, reach for a state management library with atomic updates, such as [jotai](https://jotai.pmnd.rs/).

- Use React Context deliberately. It's fine for low-velocity data — themes, user data, small local state. For medium/high-velocity data, use a library with built-in selectors ([zustand](https://docs.pmnd.rs/zustand/getting-started/introduction), [jotai](https://jotai.org/)) or, if you need selectors on top of Context specifically, [use-context-selector](https://github.com/dai-shi/use-context-selector). Don't treat Context as the default fix for props drilling — check whether [lifting the state up](https://react.dev/learn/sharing-state-between-components#lifting-state-up-by-example) or [better component composition](https://react.dev/learn/passing-data-deeply-with-context#before-you-use-context) solves it first. Don't rush to global state or Context.

- If the app updates frequently in ways that could hurt performance, prefer zero-runtime styling ([tailwind](https://tailwindcss.com/), [vanilla-extract](https://github.com/seek-oss/vanilla-extract), [CSS modules](https://github.com/css-modules/css-modules) — styles generated at build time) over runtime styling solutions like [emotion](https://emotion.sh/docs/introduction) or [styled-components](https://styled-components.com/), which generate styles during runtime.

## Children as the most basic optimization

Use the `children` prop as your first lever for cutting unnecessary rerenders — it's the easiest optimization available. JSX passed as `children` is an isolated VDOM structure the parent doesn't (and can't) re-render, so a component receiving `children` won't rerender just because its parent's own state changed:

```javascript
// Not optimized example
const App = () => <Counter />;

const Counter = () => {
  const [count, setCount] = useState(0);

  return (
    <div>
      <button onClick={() => setCount((count) => count + 1)}>
        count is {count}
      </button>
      <PureComponent /> // will rerender whenever "count" updates
    </div>
  );
};

const PureComponent = () => <p>Pure Component</p>;

// Optimized example
const App = () => (
  <Counter>
    <PureComponent />
  </Counter>
);

const Counter = ({ children }) => {
  const [count, setCount] = useState(0);

  return (
    <div>
      <button onClick={() => setCount((count) => count + 1)}>
        count is {count}
      </button>
      {children} // won't rerender whenever "count" updates
    </div>
  );
};

const PureComponent = () => <p>Pure Component</p>;
```

## Image optimizations

Lazy-load images that aren't in the viewport.

Use modern image formats such as WEBP for faster loading.

Use `srcset` so the client loads the image variant best matched to its screen size.

## Web vitals

Google factors web vitals into indexing, so track scores from [Lighthouse](https://web.dev/measure/) and [Pagespeed Insights](https://pagespeed.web.dev/) rather than treating them as optional metrics.

## Data prefetching

When you know the user is likely to navigate to a specific page next, prefetch its data ahead of time with `queryClient.prefetchQuery` from `@tanstack/react-query` — this cuts the load time the user sees when they actually land on that page.

[Data Prefetching Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/components/discussions-list.tsx)
