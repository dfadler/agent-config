---
name: testing
description: |
  Testing conventions from bulletproof-react: the
  unit/integration/e2e/static/visual-regression test types, mock API layers
  with MSW, and what to prioritize. Use when adding tests to a React app or
  deciding what kind of test a given piece of code needs.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🧪 Testing

Prioritize integration and end-to-end (e2e) tests over unit tests: per this [tweet](https://twitter.com/rauchg/status/807626710350839808), comprehensive coverage and real confidence in app functionality come from integration/e2e tests, not from isolated unit tests. Use unit tests where they fit, but don't treat them as the main safety net.

## Types of tests:

### Unit Tests

Reach for these to test shared components and functions used throughout the app, or to isolate complex logic within a single component. They're the smallest tests you can write, fast to run, and easy to write — but passing unit tests alone don't prove the connections between parts actually work.

[Unit Test Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/dialog/confirmation-dialog/__tests__/confirmation-dialog.test.tsx)

### Integration Tests

Make these the bulk of your test suite. They check how different parts of the app work together, which is where most of the real confidence comes from — unit tests passing doesn't guarantee the app functions correctly if the connections between parts are flawed. Test features (not isolated units) to ensure the app works smoothly and consistently end to end.

[Integration Test Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/app/routes/app/discussions/__tests__/discussion.test.tsx)

### E2E

Use these to evaluate the application as a whole. Automate the complete app, frontend and backend together, simulating how a real user would interact with it, to confirm the entire system functions correctly.

[E2E Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/e2e/tests/smoke.spec.ts)

## Recommended Tooling:

### [Vitest](https://vitest.dev)

Use this as the test runner. It has features similar to Jest but is more up-to-date and works well with modern tools — highly customizable and flexible.

### [Testing Library](https://testing-library.com/)

Use this and follow its philosophy: test the app the way a real-world user experiences it, not implementation details. Don't assert on a component's internal state value — assert on what it renders to the screen. This way, if you refactor to a different state management solution, the tests stay relevant since the actual output to the user shouldn't change.

### [Playwright](https://playwright.dev)

Use this to run e2e tests in an automated way. Define the commands a real-world user would execute when using the app, then run them in one of two modes:

- Browser mode — opens a dedicated browser and runs the application from start to finish, with tools to visualize and inspect each step. Use this only locally when developing, since it's the more expensive option.
- Headless mode — starts a headless browser and runs the application. Use this in CI/CD to run on every deploy.

### [MSW](https://mswjs.io)

Use this to prototype the API without a real backend: it's a mocked server inside a service worker that intercepts HTTP requests and returns responses based on handlers you define. Reach for it when you only have frontend access and are blocked by unimplemented backend features — it lets you build frontend features against real HTTP calls instead of waiting on the backend or hardcoding response data in the code.

Use it to design API endpoints too — put the business logic of the mocked API in its handlers.

[API Handlers Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/testing/mocks/handlers/auth.ts)

[Data Models Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/testing/mocks/db.ts)

Keep the mocked API server running for tests too — instead of mocking fetch, make real requests to the mocked server with the data your application would expect.
