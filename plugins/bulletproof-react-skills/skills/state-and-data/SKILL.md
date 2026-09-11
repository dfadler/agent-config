---
name: state-and-data
description: |
  State management and data-fetching conventions from bulletproof-react:
  component vs. application vs. server vs. form vs. URL state, a single shared
  API client instance, colocated request declarations paired with React Query
  hooks, and API/in-app error handling. Trigger this whenever you're about to
  add or wire up React state (useState/useReducer/context/redux/zustand/etc.),
  fetch data or call an API from a React component, set up or extend an API
  client, build a form, put data in the URL, or add error handling/error
  boundaries/error tracking to a React app — including questions like "where
  should this state live", "how should I fetch this data", or "how do I
  handle this API error".
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🗃️ State Management

Don't dump every piece of state into one centralized store. Before adding new state, decide which of the five categories below it belongs to — the right category keeps the app fast and keeps the state management code easy to follow.

## Component State

Use this for state that's specific to one component and doesn't need to be shared globally; pass it down to children as props if they need it too. Start state at the component level by default, and only lift it higher once something else in the tree actually needs it — don't globalize preemptively. Reach for:

- [useState](https://react.dev/reference/react/useState) - for simpler states that are independent
- [useReducer](https://react.dev/reference/react/useReducer) - for more complex states where on a single action you want to update several pieces of state

[Component State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/layouts/dashboard-layout.tsx)

## Application State

Use this for genuinely global concerns — modals, notifications, color mode toggles. Keep the state as close as possible to the components that actually need it rather than hoisting everything into a global store by default; that keeps the app both faster and easier to maintain.

Good Application State Solutions:

- [context](https://react.dev/learn/passing-data-deeply-with-context) + [hooks](https://react.dev/reference/react-dom/hooks)
- [redux](https://redux.js.org/) + [redux toolkit](https://redux-toolkit.js.org/)
- [mobx](https://mobx.js.org)
- [zustand](https://github.com/pmndrs/zustand)
- [jotai](https://github.com/pmndrs/jotai)
- [xstate](https://xstate.js.org/)

[Global State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/notifications/notifications-store.ts)

## Server Cache State

Treat data fetched from the server as its own category, not just more state to shove into Redux or similar. You *can* cache remote data in a general state store, but a dedicated server-cache library handles staleness, refetching, and invalidation far more effectively — use one instead.

Good Server Cache Libraries:

- [react-query](https://tanstack.com/query) - REST + GraphQL
- [swr](https://swr.vercel.app/) - REST + GraphQL
- [apollo client](https://www.apollographql.com/) - GraphQL
- [urql](https://formidable.com/open-source/urql/) - GraphQl
- [RTK](https://redux-toolkit.js.org/rtk-query)

[Server Cache State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/api/get-discussions.ts)

## Form State

Don't hand-roll form state management for anything non-trivial — reach for a form library to get validation, error handling, and submission handling built in, rather than reimplementing them. Forms in React can be [controlled and uncontrolled](https://react.dev/learn/sharing-state-between-components#controlled-and-uncontrolled-components); pick based on how complex the field set and validation needs are.

You can build a form from raw React primitives, but prefer an established library instead:

- [React Hook Form](https://react-hook-form.com/)
- [Formik](https://formik.org/)
- [React Final Form](https://github.com/final-form/react-final-form)

Wrap the library's functionality in your own abstracted `Form` component and input field components, adapted to the application's needs, rather than calling the library directly from every form.

[Form Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/form/form.tsx)

[Input Field Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/form/input.tsx)

Pair the form library with a validation library for client-side input validation:

- [zod](https://github.com/colinhacks/zod)
- [yup](https://github.com/jquense/yup)

[Validation Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/auth/components/register-form.tsx)

## URL State

When state should be shareable, bookmarkable, or reflected in navigation, put it in the URL — as a route param (e.g. `/app/${dynamicParam}`) or a query param (e.g. `/app?dynamicParam=1`) — instead of component/application state. Use a routing solution like react-router-dom to read and manipulate it directly from the address bar.

[URL State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/components/discussion-view.tsx)

---

# 📡 API Layer

### Use a Single Instance of the API Client

When the app talks to a REST or GraphQL API, create one pre-configured API client instance and reuse it everywhere — don't instantiate a new client per call site. Build it with the native fetch API or a library such as [axios](https://github.com/axios/axios), [graphql-request](https://github.com/prisma-labs/graphql-request), or [apollo-client](https://www.apollographql.com/docs/react/), with your shared config (base URL, headers, interceptors) baked in.

[API Client Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/api-client.ts)

### Define and Export Request Declarations

Don't declare API requests inline at the call site — define and export each one separately, colocated with its feature. This keeps the codebase organized and makes every available endpoint easy to find in one place.

Every API request declaration should consist of:

- Types and validation schemas for the request and response data
- A fetcher function that calls an endpoint, using the API client instance
- A hook that consumes the fetcher function that is built on top of libraries such as [react-query](https://tanstack.com/query), [swr](https://swr.vercel.app/), [apollo-client](https://www.apollographql.com/docs/react/), [urql](https://formidable.com/open-source/urql/), etc. to manage the data fetching and caching logic.

Follow this pattern so endpoints stay easy to track, and so typing the response and inferring it downstream keeps the rest of the app type-safe.

[API Request Declarations - Query - Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/api/get-discussions.ts)
[API Request Declarations - Mutation - Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/api/create-discussion.ts)

---

# ⚠️ Error Handling

### API Errors

Add an interceptor to the API client to handle errors in one place rather than at every call site: use it to trigger notification toasts, log out unauthorized users, or refresh tokens, so the app stays secure and behaves consistently on failure.

[API Errors Notification Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/api-client.ts)

### In App Errors

Use React error boundaries to contain errors locally instead of relying on a single boundary for the whole app. Place multiple boundaries around different areas of the app so that when one part fails, it doesn't take down the rest of the UI with it.

[Error Boundary Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/app/routes/app/discussions/discussion.tsx)

### Error Tracking

Track production errors rather than relying on user reports. Use a tool like [Sentry](https://sentry.io/) instead of building your own — it reports errors as they happen along with the platform/browser context, and lets you trace an error back to source when you upload source maps.
