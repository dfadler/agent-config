---
name: state-and-data
description: |
  State management and data-fetching conventions from bulletproof-react:
  component vs. application vs. server vs. form vs. URL state, a single shared
  API client instance, colocated request declarations paired with React Query
  hooks, and API/in-app error handling. Use when adding state, wiring up an
  API call, or handling request/render errors in a React app.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# State and Data

## 🗃️ State Management

Don't dump every piece of state into one centralized store. Split it by category first, then pick the right tool per category — this keeps each piece of state as close as possible to where it's actually needed and avoids unnecessary global re-renders.

### Component State

Start state here by default. Keep it local to the component, and pass it down as props to children when needed — only lift it higher if another part of the tree genuinely needs it. Use:

- [useState](https://react.dev/reference/react/useState) - for simpler states that are independent
- [useReducer](https://react.dev/reference/react/useReducer) - for more complex states where on a single action you want to update several pieces of state

[Component State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/layouts/dashboard-layout.tsx)

### Application State

Reserve this for genuinely global concerns — modals, notifications, color mode toggles. Localize it as close as possible to the components that need it; don't globalize state by default just because it's convenient.

Good Application State Solutions:

- [context](https://react.dev/learn/passing-data-deeply-with-context) + [hooks](https://react.dev/reference/react-dom/hooks)
- [redux](https://redux.js.org/) + [redux toolkit](https://redux-toolkit.js.org/)
- [mobx](https://mobx.js.org)
- [zustand](https://github.com/pmndrs/zustand)
- [jotai](https://github.com/pmndrs/jotai)
- [xstate](https://xstate.js.org/)

[Global State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/notifications/notifications-store.ts)

### Server Cache State

Don't cache remote data in a general-purpose store like Redux — it's technically possible but not optimal. Reach for a dedicated server-cache library instead; they handle caching, invalidation, and refetching far better than a generic state store.

Good Server Cache Libraries:

- [react-query](https://tanstack.com/query) - REST + GraphQL
- [swr](https://swr.vercel.app/) - REST + GraphQL
- [apollo client](https://www.apollographql.com/) - GraphQL
- [urql](https://formidable.com/open-source/urql/) - GraphQl
- [RTK](https://redux-toolkit.js.org/rtk-query)

[Server Cache State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/api/get-discussions.ts)

### Form State

Use a dedicated form library rather than hand-rolling form state with React primitives alone — it's possible, but you lose the built-in validation, error handling, and submission handling these libraries give you for free, and forms often grow many interdependent fields that need this.

Forms in React can be [controlled and uncontrolled](https://react.dev/learn/sharing-state-between-components#controlled-and-uncontrolled-components).

Pick one of:

- [React Hook Form](https://react-hook-form.com/)
- [Formik](https://formik.org/)
- [React Final Form](https://github.com/final-form/react-final-form)

Wrap the library in your own abstracted `Form` component and input field components, adapted to the application's needs, rather than using the library's primitives directly everywhere.

[Form Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/form/form.tsx)

[Input Field Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/form/input.tsx)

Validate inputs on the client by integrating one of these with the form library:

- [zod](https://github.com/colinhacks/zod)
- [yup](https://github.com/jquense/yup)

[Validation Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/auth/components/register-form.tsx)

### URL State

When state needs to be shareable via link or survive a refresh, put it in the URL instead — as a route param (`/app/${dynamicParam}`) or query param (`/app?dynamicParam=1`). Use a routing solution like react-router-dom to read and manipulate it.

[URL State Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/components/discussion-view.tsx)

## 📡 API Layer

### Use a Single Instance of the API Client

Create one pre-configured API client instance and reuse it everywhere, rather than constructing clients ad hoc. Build it on the native fetch API or a library like [axios](https://github.com/axios/axios), [graphql-request](https://github.com/prisma-labs/graphql-request), or [apollo-client](https://www.apollographql.com/docs/react/), with your config baked in once.

[API Client Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/api-client.ts)

### Define and Export Request Declarations

Don't declare API requests inline at the call site — define and export them separately, colocated by feature, so every available endpoint is easy to find and the codebase stays organized.

Give every API request declaration:

- Types and validation schemas for the request and response data
- A fetcher function that calls an endpoint, using the API client instance
- A hook built on a data-fetching library — [react-query](https://tanstack.com/query), [swr](https://swr.vercel.app/), [apollo-client](https://www.apollographql.com/docs/react/), [urql](https://formidable.com/open-source/urql/), etc. — that consumes the fetcher and manages fetching/caching

Type the responses and let those types flow down through the app — this is what gives you real type safety at the point of use, not just at the fetch boundary.

[API Request Declarations - Query - Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/api/get-discussions.ts)
[API Request Declarations - Mutation - Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/api/create-discussion.ts)

## ⚠️ Error Handling

### API Errors

Add an interceptor to handle errors centrally — use it to fire notification toasts, log out unauthorized users, or trigger a token refresh, instead of scattering this handling across every call site.

[API Errors Notification Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/api-client.ts)

### In App Errors

Don't rely on a single error boundary for the whole app — place multiple error boundaries at different points in the tree instead, so an error in one area is contained there and doesn't take down the rest of the app's functionality.

[Error Boundary Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/app/routes/app/discussions/discussion.tsx)

### Error Tracking

Track production errors with a tool like [Sentry](https://sentry.io/) rather than rolling your own — it reports every break along with platform/browser context. Upload source maps to it so stack traces resolve back to your actual source.
