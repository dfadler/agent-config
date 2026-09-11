---
name: security
description: |
  Security conventions from bulletproof-react: token storage and
  authentication for SPAs, authorization patterns, and other client-side
  hardening practices. Use when implementing auth, authorization checks, or
  handling sensitive data in a React app.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🔐 Security

## Auth

Never treat client-side authentication as sufficient on its own — always enforce authorization on the server too. Client-side auth improves UX and complements server-side security, but it does not replace it.

Protecting resources comprises two key components:

### Authentication

Authentication verifies the identity of a user. In single-page applications (SPAs), authenticate users with JSON Web Tokens ([JWT](https://jwt.io/)): issue a token on login/registration, store it in the application, and send it with every authenticated request (header or cookie) to validate the user's identity and access permissions.

Prefer storing the token in application state — it's the most secure option. But be aware that a page refresh resets application state, which loses the user's authentication status.

That's why you'll need to persist the token in a cookie or `localStorage`/`sessionStorage` instead.

#### `localStorage` vs cookie for storing tokens

Avoid storing authentication tokens in `localStorage` when you can — it's readable by any script on the page, so a Cross-Site Scripting ([XSS](https://owasp.org/www-community/attacks/xss/)) vulnerability can let an attacker steal the token directly.

Prefer cookies configured with the `HttpOnly` attribute instead, since that makes them inaccessible to client-side JavaScript. In the sample app, js-cookie is used for cookie management on the assumption that the real API enforces `HttpOnly`, so the application never has client-side access to the cookie.

Storing the token securely isn't enough on its own — also sanitize all user inputs before rendering them anywhere in the application. This reduces the app's exposure to XSS attacks regardless of where the token lives.

[HTML Sanitization Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/md-preview/md-preview.tsx)

For a full list of security risks, check [OWASP](https://owasp.org/www-project-top-10-client-side-security-risks/).

#### Handling user data

Treat user info as global state, available from anywhere in the application. If you're already using `react-query`, reach for [react-query-auth](https://github.com/alan2207/react-query-auth) to manage user state — it handles the details once you give it configuration. Otherwise, use React context + hooks, or a third-party state management library.

[Auth Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/auth.tsx)

Treat the presence of a user object as the signal that the user is authenticated.

### Authorization

Authorization verifies whether a user has permission to access a specific resource within the application.

#### RBAC (Role based access control)

[Authorization Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/authorization.tsx)

Use role-based authorization when access maps cleanly onto a small set of roles: define roles (e.g. `USER`, `ADMIN`) and associate each with permissions, then grant access based on the user's role — for instance, restrict certain functionality to regular users while letting administrators access everything.

[RBAC Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/components/delete-discussion.tsx)

#### PBAC (Permission based access control)

Reach for permission-based access control when RBAC's role granularity isn't precise enough — for example, when access must depend on specific criteria like resource ownership, such as letting only a comment's author delete it. PBAC gives you that finer-grained control where RBAC would otherwise force everyone with a role to share the same permissions.

Use the RBAC component, passing it allowed roles, for role-based protection. When you need stricter, criteria-based protection instead, pass it a policies check.

[PBAC Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/comments/components/comments-list.tsx)
