---
name: security
description: |
  Security conventions from bulletproof-react: token storage and
  authentication for SPAs, authorization patterns, and other client-side
  hardening practices. Use when implementing auth, authorization checks, or
  handling sensitive data in a React app. Reach for this whenever a task
  involves deciding where to store a JWT after login, wiring up route/component
  guards so only certain roles can see a feature, restricting an action (like
  deleting a comment) to its owner, or reviewing a PR that touches
  authentication/authorization code — for example "where should I store the
  auth token", "how do I hide this button from non-admins", "only the comment
  author should be able to delete it", or "is this login flow XSS-safe".
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🔐 Security

## Auth

Client-side authentication improves UX, but it is not a substitute for server-side enforcement — always assume the server independently protects its resources, and treat anything you do here as a complement to that, not a replacement.

Protecting resources comprises two key components:

### Authentication

Authentication verifies who the user is. In single-page applications (SPAs), authenticate users with a JSON Web Token ([JWT](https://jwt.io/)): issue it on login/registration, store it in the app, and send it with every authenticated request (header or cookie) so the server can validate identity and permissions.

Prefer storing the token in application state — that's the most secure option. But know the tradeoff: a page refresh resets that state, which drops the user's authentication status.

That's why you'll typically still need to persist the token in a cookie or `localStorage`/`sessionStorage`.

#### `localStorage` vs cookie for storing tokens

Avoid `localStorage` for tokens when you can: it's readable by any script on the page, so a Cross-Site Scripting ([XSS](https://owasp.org/www-community/attacks/xss/)) vulnerability elsewhere in the app can be used to steal the token directly.

Prefer a cookie configured with `HttpOnly` instead — client-side JavaScript can't read it at all, which closes off that theft vector. In the sample app, js-cookie is used for cookie management, on the assumption that the real API enforces `HttpOnly` so the client never actually has cookie access.

Storing the token safely isn't sufficient on its own — also sanitize every user input before rendering it, since that's what keeps XSS vulnerabilities from being introduced in the first place, token storage aside.

[HTML Sanitization Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/md-preview/md-preview.tsx)

For a full list of security risks, check [OWASP](https://owasp.org/www-project-top-10-client-side-security-risks/).

#### Handling user data

Treat user info as global state, available from anywhere in the app. If the project already uses `react-query`, use [react-query-auth](https://github.com/alan2207/react-query-auth) — it handles the user-state wiring once you give it configuration. Otherwise, fall back to React context + hooks or a third-party state management library.

[Auth Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/auth.tsx)

Treat the presence of a user object as the signal that the user is authenticated.

### Authorization

Authorization verifies whether the authenticated user has permission to access a specific resource in the app.

#### RBAC (Role based access control)

[Authorization Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/authorization.tsx)

Use role-based authorization when access maps cleanly onto a small set of roles: define roles (e.g. USER, ADMIN) and associate each with its permissions, then gate functionality by the user's role — for instance, restrict certain features to regular users while letting admins reach everything.

[RBAC Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/components/delete-discussion.tsx)

#### PBAC (Permission based access control)

Reach for PBAC instead of RBAC when access needs to be more granular than a role can express — for example, when only the owner of a specific resource should be allowed to act on it. For a user's comment, PBAC lets you restrict deletion to the comment's author specifically, rather than to a whole role.

Use the RBAC component (passing it the allowed roles) when role-based protection is enough. When you need stricter, per-resource protection, pass it a policy check instead.

[PBAC Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/comments/components/comments-list.tsx)
