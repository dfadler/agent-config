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

### Code Splitting

Split production JavaScript into smaller files so the app downloads in parts and fetches only what's needed, instead of one large bundle up front.

Split at the routes level as the default: load only what's essential for the initial route, and lazily fetch the rest as the user navigates. Don't over-split — each additional chunk is an additional request, and too many chunks can make loading slower, not faster. Target strategic boundaries (routes, heavy/rarely-used features) rather than splitting everything.

[Code Splitting Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/app/router.tsx)

### Component and state optimizations

- Don't put everything in a single state — that triggers unnecessary re-renders across every consumer. Split global state into multiple states, scoped to where each piece is actually used.

- Keep state as close as possible to where it's used, so components that don't depend on it don't re-render when it updates.

- When a piece of state is initialized by an expensive computation, pass the state initializer as a function rather than calling it directly — otherwise the expensive function runs on every re-render instead of once. e.g.:

```javascript
// instead of this which would be executed on every re-render:
const [state, setState] = React.useState(myExpensiveFn());

// prefer this which is executed only once:
const [state, setState] = React.useState(() => myExpensiveFn());
```

- If the app needs to track many elements of state at once, consider a state management library with atomic updates such as [jotai](https://jotai.pmnd.rs/).

- Use React Context deliberately. It's fine for low-velocity data (themes, user data, small local state), but for medium/high-velocity data, reach for a selector-aware approach — either the [use-context-selector](https://github.com/dai-shi/use-context-selector) library, or a state management library with built-in selectors like [zustand](https://docs.pmnd.rs/zustand/getting-started/introduction) or [jotai](https://jotai.org/). Don't default to Context as the "golden tool" for props drilling — check first whether [lifting state up](https://react.dev/learn/sharing-state-between-components#lifting-state-up-by-example) or [better component composition](https://react.dev/learn/passing-data-deeply-with-context#before-you-use-context) solves it instead. Don't rush into Context and global state.

- If the app is expected to update frequently in ways that could hurt performance, prefer zero-runtime styling solutions ([tailwind](https://tailwindcss.com/), [vanilla-extract](https://github.com/seek-oss/vanilla-extract), [CSS modules](https://github.com/css-modules/css-modules), which generate styles at build time) over runtime styling solutions such as [emotion](https://emotion.sh/docs/introduction) or [styled-components](https://styled-components.com/) (which generate styles at runtime).

### Children as the most basic optimization

Reach for the `children` prop before any heavier optimization — it's the simplest way to eliminate unnecessary re-renders. JSX passed as `children` is an isolated VDOM structure that the parent doesn't (and can't) re-render, so a component holding local state won't drag its children along on every update. Example:

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

### Image optimizations

- Lazy-load images that aren't in the viewport.
- Use modern formats such as WEBP for faster loading.
- Use `srcset` so the client loads the image size best suited to its screen.

### Web vitals

Google factors web vitals into indexing, so track scores from [Lighthouse](https://web.dev/measure/) and [Pagespeed Insights](https://pagespeed.web.dev/) and watch for regressions.

### Data prefetching

Prefetch data before the user navigates to a page, using `queryClient.prefetchQuery` from `@tanstack/react-query`, when you already know the user is likely to land on a specific page next — this hides the fetch latency that would otherwise show up on navigation.

[Data Prefetching Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/components/discussions-list.tsx)
