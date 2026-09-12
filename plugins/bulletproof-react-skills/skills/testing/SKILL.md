---
name: testing
description: |
  Testing strategy conventions from bulletproof-react: when to reach for a
  unit vs. integration vs. e2e test, and the recommended tooling (Vitest,
  Testing Library, Playwright, MSW) for each. Use this whenever adding tests
  to a React app, deciding what kind of test a piece of code actually needs,
  or reviewing a PR's test coverage — especially when the default has been
  "add a unit test" without considering whether an integration test would
  give more real confidence. Reach for this when the user asks things like
  "what kind of test should this component have", "should I mock the API
  for this test", or "how do I set up e2e tests for this app".
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🧪 Testing

Prioritize integration and e2e coverage over unit tests when deciding where to invest testing effort — as this [tweet](https://twitter.com/rauchg/status/807626710350839808) argues, that's where the real confidence in application functionality comes from. Unit tests still have a place for isolating individual components, but don't treat them as the primary source of confidence.

## Types of tests:

### Unit Tests

Reach for these to isolate a single shared component/function used throughout the app, or to test complex logic inside one component. They're fast to run and easy to write, but don't rely on them alone — passing unit tests don't prove the connections between parts of your app actually work.

[Unit Test Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/dialog/confirmation-dialog/__tests__/confirmation-dialog.test.tsx)

### Integration Tests

Favor integration tests for most of your testing effort — they check how different parts of the application work together, which is what actually matters for reliability. A component passing its unit test doesn't mean the app works if the connections between components are broken, so test features (not just isolated parts) with integration tests to ensure the app works smoothly and consistently.

[Integration Test Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/app/routes/app/discussions/__tests__/discussion.test.tsx)

### E2E

Use e2e tests to evaluate the application as a whole. Automate the complete application — frontend and backend together — to confirm the entire system functions correctly, simulating how a real user would interact with it.

[E2E Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/e2e/tests/smoke.spec.ts)

## Recommended Tooling:

### [Vitest](https://vitest.dev)

Use Vitest as the test runner. It offers features similar to Jest but is more up to date, works well with modern tooling, and is highly customizable and flexible.

### [Testing Library](https://testing-library.com/)

Use Testing Library and follow its philosophy: test the app the way a real user experiences it, not its implementation details. Don't assert on a component's internal state value — assert on what it renders to the screen. This way, if you refactor the app to a different state management solution, the tests stay relevant because the user-facing output hasn't changed.

### [Playwright](https://playwright.dev)

Use Playwright to run e2e tests in an automated way: define the commands a real user would execute against the app, then run them. It supports 2 modes — pick based on context:

- Browser mode — opens a dedicated browser and runs the application start to finish, with tools to visualize and inspect each step. Use this locally during development; it's too expensive to run routinely elsewhere.
- Headless mode — runs a headless browser with no UI. Use this in CI/CD, on every deploy.

### [MSW](https://mswjs.io)

Use MSW to prototype and mock the API layer. It doesn't run an actual backend: in the browser it intercepts requests via a Service Worker (`setupWorker`), and in Node.js test runs — including under Vitest — it uses `setupServer` instead, since there's no Service Worker in that environment. Either way you define the same handlers and it returns the responses you specify. Reach for it when you're blocked by unfinished backend work: instead of waiting on the feature or hardcoding response data in your frontend code, define handlers and make real HTTP calls against the mock while building frontend features.

Use it to design API endpoints too — put the mocked API's business logic in its handlers.

[API Handlers Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/testing/mocks/handlers/auth.ts)

[Data Models Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/testing/mocks/db.ts)

A fully functional mocked API server also pays off in tests: instead of mocking `fetch`, make requests to the mocked server with the data your application expects.
