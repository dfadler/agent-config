---
name: state-and-data
description: |
  State management and data-fetching conventions from bulletproof-react:
  component vs. application vs. server vs. form vs. URL state, a single shared
  API client instance, colocated request declarations paired with React Query
  hooks, and API/in-app error handling. Use when adding state, wiring up an
  API call, or handling request/render errors in a React app. Reach for this
  whenever you're about to decide "should this be useState or global state?",
  add a new fetch/mutation to a React app, wire up form validation, or figure
  out where a caught error should surface — e.g. "where should I put this
  modal's open/closed state?", "how do I fetch and cache this list from the
  API?", "the app crashed on one bad component and took the whole page down
  with it."
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# State and Data

## 🗃️ State Management

Don't default to one centralized store for everything — sort state by *how it's used* first, since that determines which tool is actually appropriate for it. Categorizing state this way keeps the app performant and keeps you from reaching for a global store when a local `useState` would do.

### Component State

Scope state to the component that owns it, and pass it down as props only when a child actually needs it. Start local; only lift it up once something else in the tree genuinely requires it. Use:

- [useState](https://react.dev/reference/react/useState) - for simpler states that are independent
- [useReducer](https://react.dev/reference/react/useReducer) - for more complex states where on a single action you want to update several pieces of state

[Component State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/layouts/dashboard-layout.tsx)

### Application State

Reach for application state only for things that are genuinely global — modals, notifications, color mode. Don't promote state to this layer by default; keep it as close as possible to the components that need it, or you'll end up with a bloated, hard-to-reason-about global store.

Good Application State Solutions:

- [context](https://react.dev/learn/passing-data-deeply-with-context) + [hooks](https://react.dev/reference/react/hooks)
- [redux](https://redux.js.org/) + [redux toolkit](https://redux-toolkit.js.org/)
- [mobx](https://mobx.js.org)
- [zustand](https://github.com/pmndrs/zustand)
- [jotai](https://github.com/pmndrs/jotai)
- [xstate](https://xstate.js.org/)

[Global State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/notifications/notifications-store.ts)

### Server Cache State

Don't cache server-fetched data in a general state store like Redux — it's the wrong tool for this job. Use a dedicated cache library instead; it'll handle invalidation, refetching, and staleness far better than a hand-rolled store.

Good Server Cache Libraries:

- [react-query](https://tanstack.com/query) - REST + GraphQL
- [swr](https://swr.vercel.app/) - REST + GraphQL
- [apollo client](https://www.apollographql.com/) - GraphQL
- [urql](https://formidable.com/open-source/urql/) - GraphQl
- [RTK](https://redux-toolkit.js.org/rtk-query)

[Server Cache State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/api/get-discussions.ts)

### Form State

Use a form library rather than hand-rolling validation, error handling, and submission logic — it's a lot of surface area to get right on your own, and these libraries already cover it.

Forms in React can be [controlled and uncontrolled](https://react.dev/learn/sharing-state-between-components#controlled-and-uncontrolled-components).

Depending on the application needs, they might be pretty complex with many different fields that require validation.

Although it's possible to build a form using only React primitives, prefer one of these instead:

- [React Hook Form](https://react-hook-form.com/)
- [Formik](https://formik.org/)
- [React Final Form](https://github.com/final-form/react-final-form)

Wrap the library in your own abstracted `Form` component and input field components, adapted to the application's needs, rather than using the library's primitives directly everywhere.

[Form Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/form/form.tsx)

[Input Field Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/form/input.tsx)

Pair the form library with a validation library for client-side input validation:

- [zod](https://github.com/colinhacks/zod)
- [yup](https://github.com/jquense/yup)

[Validation Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/auth/components/register-form.tsx)

### URL State

When state should be shareable, bookmarkable, or reflect navigation (a dynamic param like `/app/${dynamicParam}`, or a query param like `/app?dynamicParam=1`), put it in the URL rather than component or application state. Use a routing solution like react-router-dom to read and manipulate it.

[URL State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/components/discussion-view.tsx)

## 📡 API Layer

### Use a Single Instance of the API Client

Create one pre-configured API client instance and reuse it everywhere, instead of constructing a new client per call site. Build it with the native fetch API or a library like [axios](https://github.com/axios/axios), [graphql-request](https://github.com/prisma-labs/graphql-request), or [apollo-client](https://www.apollographql.com/docs/react/), with your shared config baked in once.

[API Client Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/api-client.ts)

### Define and Export Request Declarations

Don't declare API requests inline at the call site — define and export them separately, colocated with the feature that uses them. This keeps the codebase organized and makes every endpoint the app uses easy to track.

Every API request declaration should consist of:

- Types and validation schemas for the request and response data
- A fetcher function that calls an endpoint, using the API client instance
- A hook that consumes the fetcher function, built on top of a library like [react-query](https://tanstack.com/query), [swr](https://swr.vercel.app/), [apollo-client](https://www.apollographql.com/docs/react/), or [urql](https://formidable.com/open-source/urql/) to manage the fetching and caching logic

Type the responses and let that typing flow down through the app — it's what gives you type safety on data coming back from the API.

[API Request Declarations - Query - Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/api/get-discussions.ts)
[API Request Declarations - Mutation - Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/api/create-discussion.ts)

## ⚠️ Error Handling

### API Errors

Add an interceptor to the API client to handle errors centrally — use it to fire notification toasts, log out unauthorized users, or trigger a token-refresh request, rather than handling these cases ad hoc at each call site.

[API Errors Notification Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/api-client.ts)

### In App Errors

Use React error boundaries, and place multiple of them at different points in the tree rather than wrapping the whole app in a single one. That way a failure in one area gets contained and handled locally instead of taking down the entire application.

[Error Boundary Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/app/routes/app/discussions/discussion.tsx)

### Error Tracking

Track production errors with a dedicated tool like [Sentry](https://sentry.io/) rather than rolling your own — it reports issues that break the app along with the platform/browser context they occurred in. Upload source maps so errors point back to your actual source code, not the bundled output.
