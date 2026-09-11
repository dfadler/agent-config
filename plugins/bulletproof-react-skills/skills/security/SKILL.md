---
name: security
description: |
  Security conventions for React apps, distilled from bulletproof-react: JWT
  authentication for SPAs, cookie vs. localStorage tradeoffs for token storage,
  XSS input sanitization, and RBAC/PBAC authorization patterns. Use this
  whenever implementing a login/auth flow, deciding where to store a token,
  adding a protected route or role/permission check, or reviewing any code
  that handles user credentials, permissions, or sensitive data — even if the
  user doesn't say "security" explicitly.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# Security

Client-side authentication and authorization improve the user experience, but
they are never a substitute for server-side enforcement. Treat everything
below as a UX layer on top of protections the server must enforce
independently — a client-side check is a convenience, not the security
boundary.

## Authentication: verifying who the user is

In a single-page app, authenticate with a [JWT](https://jwt.io/): the server
issues a token on login/register, and every subsequent request sends it
(header or cookie) to prove identity.

**Where to store the token** — prefer a cookie over `localStorage`/`sessionStorage`:

- `localStorage` is readable by any JavaScript running on the page, so a
  single [XSS](https://owasp.org/www-community/attacks/xss/) vulnerability
  anywhere in the app can steal the token directly. Only fall back to it if
  the app genuinely can't use cookies.
- A cookie set with `HttpOnly` is inaccessible to client-side JavaScript
  entirely, which removes that attack surface — set this up on the API side;
  the client shouldn't need direct cookie access at all.
- Storing the token in application state (not persisted) is the most secure
  option, but it resets on page refresh, losing the session. Weigh that
  against how often your users actually refresh/reload before choosing it.

Whichever storage you pick, also sanitize every piece of user input before
rendering it — an unsanitized input is an XSS vector regardless of how well
the token itself is stored:

[HTML Sanitization Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/components/ui/md-preview/md-preview.tsx)

Check [OWASP's client-side security risks](https://owasp.org/www-project-top-10-client-side-security-risks/) for the fuller threat list before assuming a given input is safe to render as-is.

Treat the authenticated user as global state — react-query with
[react-query-auth](https://github.com/alan2207/react-query-auth), or context +
hooks, or another state library. Components anywhere in the tree need to know
"is someone logged in," so don't scope this locally. Bulletproof-react's own
convention: a present user object *is* "authenticated" — don't also maintain
a separate `isAuthenticated` flag that could drift out of sync with it.

[Auth Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/auth.tsx)

## Authorization: verifying what the user can do

Once you know who the user is, decide what they're allowed to do. Two
patterns — pick based on how fine-grained the check needs to be:

**RBAC (role-based)** — assign each user a role (e.g. `USER`, `ADMIN`) and
gate features by role. Reach for this first; it's simpler to reason about and
covers most "some users can do X, others can't" cases.

[RBAC Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/lib/authorization.tsx)
[RBAC Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/discussions/components/delete-discussion.tsx)

**PBAC (permission-based)** — use this when a role alone isn't precise
enough. "Only the comment's author can delete it" isn't a role-shaped rule
(any `USER` has the same role, but only one of them should be able to delete
a given comment) — check a specific permission/policy against the resource
instead.

[PBAC Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/src/features/comments/components/comments-list.tsx)

In practice: use the RBAC component when a plain role check is enough; pass
an explicit policy check instead when the rule depends on ownership or other
resource data, not just which role the user holds.
