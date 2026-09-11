---
name: performance
description: |
  Performance conventions from bulletproof-react: code splitting,
  component/state update optimization, list virtualization, image
  optimization, and bundle analysis. Use when a React app feels slow or before
  shipping a feature that renders large lists or heavy assets. Reach for this
  whenever you're about to add a route, decide where a piece of state should
  live, render a list of unknown or large size, or add images — and whenever
  a request mentions phrasing like "this page feels slow", "why is this
  component re-rendering so much", or "how should I load these images".
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🚄 Performance

## Code Splitting

Split production JavaScript into smaller files so the app downloads only what's needed, when it's needed, instead of one monolithic bundle upfront.

Split at the routes level by default: load only what a route needs initially, and fetch the rest lazily as the user navigates. Don't over-split — splitting too aggressively multiplies the number of requests needed to fetch all the chunks and can make things slower, not faster. Target the parts of the app that actually matter for initial load rather than splitting everything.

[Code Splitting Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/app/router.tsx)

## Component and state optimizations

- Don't put everything in a single state — that triggers unnecessary re-renders. Split global state into multiple states, scoped to where each piece is actually used.

- Keep state as close as possible to where it's used, so components that don't depend on it don't re-render when it updates.

- When a piece of state is initialized by an expensive computation, use the state initializer function form instead of calling it directly — otherwise the expensive function reruns on every re-render instead of just once:

```javascript
// instead of this which would be executed on every re-render:
const [state, setState] = React.useState(myExpensiveFn());

// prefer this which is executed only once:
const [state, setState] = React.useState(() => myExpensiveFn());
```

- If the app needs to track many elements of state at once, consider a state management library with atomic updates, such as [jotai](https://jotai.pmnd.rs/).

- Use React Context deliberately. Reach for it with low-velocity data — themes, user data, small local state — but for medium/high-velocity data, consider the [use-context-selector](https://github.com/dai-shi/use-context-selector) library (selectors are already built in to most popular state management libraries like [zustand](https://docs.pmnd.rs/zustand/getting-started/introduction) or [jotai](https://jotai.org/)). Don't treat Context as the default fix for props drilling — check first whether [lifting the state up](https://react.dev/learn/sharing-state-between-components#lifting-state-up-by-example) or [a proper composition of components](https://react.dev/learn/passing-data-deeply-with-context#before-you-use-context) solves it instead. Don't rush into Context or global state.

- If the app will have frequent updates that could hurt performance, prefer zero-runtime styling solutions ([tailwind](https://tailwindcss.com/), [vanilla-extract](https://github.com/seek-oss/vanilla-extract), [CSS modules](https://github.com/css-modules/css-modules), which generate styles at build time) over runtime styling solutions like [emotion](https://emotion.sh/docs/introduction) or [styled-components](https://styled-components.com/), which generate styles at runtime.

## Children as the most basic optimization

Reach for the `children` prop as the simplest, easiest optimization available — it eliminates a lot of unnecessary re-renders when applied properly. JSX passed as `children` is an isolated VDOM structure that the parent cannot and does not need to re-render, so use it to shield components from a parent's state updates. Example:

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

Use `srcset` to serve the most optimal image for the client's screen size.

## Web vitals

Google factors web vitals into indexing, so track [Lighthouse](https://web.dev/measure/) and [Pagespeed Insights](https://pagespeed.web.dev/) scores rather than treating them as optional.

## Data prefetching

Prefetch data before the user navigates to a page using `queryClient.prefetchQuery` from `@tanstack/react-query`, to prefetch a specific query's data ahead of time. Use this when you know the user is likely to navigate to a given page next — it cuts the load time they see when they get there.

[Data Prefetching Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/components/discussions-list.tsx)
