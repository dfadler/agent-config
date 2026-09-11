---
name: testing
description: |
  Testing strategy conventions from bulletproof-react: when to reach for a
  unit vs. integration vs. e2e test, and the recommended tooling (Vitest,
  Testing Library, Playwright, MSW) for each. Use this whenever adding tests
  to a React app, deciding what kind of test a piece of code actually needs,
  or reviewing a PR's test coverage — especially when the default has been
  "add a unit test" without considering whether an integration test would
  give more real confidence.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# Testing

Default to integration and e2e tests over unit tests for most of an
application's coverage (a view also argued in [this
tweet](https://twitter.com/rauchg/status/807626710350839808)). They exercise
how parts of the app actually work together, which is where real confidence
in correctness comes from — a suite of passing unit tests can still hide a
broken connection between components
that individually work fine.

## Choosing a test type

**Unit tests** — reach for these to isolate a single complex function, or a
shared component/utility used throughout the app. Fast and cheap to write,
but passing unit tests alone don't prove the app actually works end to end.

[Unit Test Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/dialog/confirmation-dialog/__tests__/confirmation-dialog.test.tsx)

**Integration tests** — default here for most new coverage. They check that
different parts of the app work together correctly, which unit tests can't
catch by construction (each unit test only ever exercises one part in
isolation).

[Integration Test Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/app/routes/app/discussions/__tests__/discussion.test.tsx)

**E2E tests** — use these to validate a complete user flow across frontend
and backend together, simulating exactly how a real user would interact with
the app.

[E2E Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/e2e/tests/smoke.spec.ts)

## Tooling

- **[Vitest](https://vitest.dev)** — the test runner. Jest-compatible API,
  faster, and a better fit for modern build tooling.
- **[Testing Library](https://testing-library.com/)** — write assertions
  against what the user sees rendered, not internal implementation details.
  Assert on rendered output rather than a component's internal state value —
  that way the test survives a state-management refactor, since the
  user-visible output doesn't need to change even when the internals do.
- **[Playwright](https://playwright.dev)** — for e2e. Use browser mode
  locally when you need to see and step through a run; use headless mode in
  CI, since it's cheaper and needs no visible browser.
- **[MSW](https://mswjs.io)** — mock the API at the network level (a service
  worker intercepting real HTTP calls) rather than mocking `fetch` directly,
  so tests exercise the same request/response path production code does.
  This is also useful for building a frontend against an API that isn't
  finished yet: define the expected response shape in a handler and start
  building immediately, instead of waiting on the backend or hardcoding
  response data in application code.

[API Handlers Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/testing/mocks/handlers/auth.ts)
[Data Models Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/testing/mocks/db.ts)
