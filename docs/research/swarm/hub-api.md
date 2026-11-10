# CLIProxyAPI v8: management API, affinity config, session-id precedence

Ticket: #1081 (part of #1071). Sources read 2026-11-10 from `main` of
[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (Go module path `.../CLIProxyAPI/v8`). Nothing was
installed or run; response shapes below are read from handler source, not observed on a live core. `main` moves several
times a day, so pin a release before relying on any field name.

## 1. Management API (read over loopback with the management key)

Base path `/v8/management`; `/v0/management` still works. Auth: `Authorization: Bearer <key>` or `X-Management-Key: <key>`
([management-api-v8.md](https://github.com/router-for-me/CLIProxyAPI/blob/main/docs/management-api-v8.md)). With
`management.secret-key` empty the routes return 404; `management.allow-remote` defaults to false, so only localhost reaches
them, and a key is still required from localhost
([config.example.yaml](https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml)). The handler treats client
IP `127.0.0.1` or `::1` as local and keeps a per-IP failed-attempt ban with a 30-minute `banDuration`
([handler.go](https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/api/handlers/management/handler.go)). Home mode
disables local management endpoints (management-api-v8.md).

The doc lists endpoints but gives no JSON schemas for the ones the pane needs. Shapes below come from handler source.

| Need | Endpoint | Shape (from source) |
| --- | --- | --- |
| Credential status and cooldown | `GET /credentials` (`?name=`, `?auth_index=` filters; optional pagination) | `{"observed_at": <time>, "files": [...]}` ([auth_files.go](https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/api/handlers/management/auth_files.go) `ListAuthFiles`) |
| Cooldown reset | `POST /routing/cooldown/reset` | body `{"auth_index": "<idx>"}` required; returns `{"status":"ok","auth_index":...,"models":...}` ([quota.go](https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/api/handlers/management/quota.go)) |
| Per-API-key usage | `GET /observability/usage/api-keys` | `{provider: {"<base_url>\|<key>": {success, failed, recent_requests[]}}}`, only credentials whose account kind is `api_key` ([api_key_usage.go](https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/api/handlers/management/api_key_usage.go)) |
| Usage event queue | `GET /observability/usage/queue?count=N` | JSON array of raw event records. It calls `redisqueue.PopOldest`, so a read removes the records ([usage.go](https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/api/handlers/management/usage.go)). Do not poll it from a pane that is not the sole consumer. |

Each `files[]` entry for a credential (`buildAuthFileEntryLocked` in auth_files.go) carries: `id`, `auth_index`, `name`,
`type`/`provider`, `label`, `status`, `status_message`, `disabled`, `unavailable`, `runtime_only`, `success`, `failed`,
`recent_requests`, `quota` (`{observed_at, signals: map[string]string}`), optional `model_quotas` (per model, same shape),
`email`, `account_type`, `account`, `created_at`, `updated_at`, `last_refresh`, `next_retry_after` (the cooldown end),
`priority`, `note`. The v8 doc adds, for Codex entries, `requires_sign_in`, `renewal_state`, `recovery_stage`,
`refresh_error`, `next_action`, `access_token_expires_at`, `next_refresh_after` (management-api-v8.md); whether the same
fields appear on Claude entries is unconfirmed. The keys inside `quota.signals` were not read; unconfirmed. In Home mode
cooldowns are not known locally (`cooldownsKnown := !HomeEnabled()` in `ListAuthFiles`).

Related v8 routes (route table: [server_management_v8.go](https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/api/server_management_v8.go)):
`/credentials/refresh`, `/credentials/verify`, `/credentials/status` (PATCH), `/credentials/fields` (PATCH),
`/config` and `/config/<section>/<field>` (GET/PUT/PATCH). Config JSON writes take the bare value, no envelope.

Pane implication: one `GET /credentials` poll gives status, cooldown end, per-credential success/failed counts and quota
signals. `/observability/usage/api-keys` does not cover OAuth accounts.

## 2. Affinity and routing config keys

All under `routing:` in v8 config ([config.example.yaml](https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml)):

| Key | Default | Notes |
| --- | --- | --- |
| `routing.strategy` | `round-robin` | also `weighted-round-robin` (per-credential integer `weight`, default 1, max 1000000), `fill-first` |
| `routing.session-affinity` | `false` | universal session-sticky routing, all clients |
| `routing.session-affinity-ttl` | `"1h"` | how long session-to-credential bindings are kept (Go duration string) |
| `routing.session-affinity-subagents` | `true` | child sessions inherit the parent credential; ignored if affinity is off |
| `routing.session-affinity-rebind-on` | `"any"` | `any`, `quota`, `never`; ignored if affinity is off |
| `routing.retry.request-retry` / `max-retry-credentials` / `max-retry-interval` | 3 / 0 / 30 | retry rounds, credential cap, max cooldown wait (s) |
| `routing.cooldown.disable-cooling` | `false` | global cooldown off switch |
| `routing.cooldown.save-cooldown-status` | `false` | persist cooldown as `.cds` files; otherwise memory only |
| `routing.cooldown.transient-error-cooldown-seconds` | `0` | 0 keeps the legacy 60 s; -1 disables |

Write path: `PATCH /v8/management/config` with a nested body, or `PUT /config/routing/session-affinity`
(management-api-v8.md). Weighted credits are process-local and reset on restart (management-api-v8.md).

## 3. Session-id precedence

An established binding outranks credential priority; priority only decides cold bindings, sessionless requests and
post-failover rebinding (config.example.yaml comments). Session id extraction order, from the `ExtractSessionID` doc
comment in [selector.go](https://github.com/router-for-me/CLIProxyAPI/blob/main/sdk/cliproxy/auth/selector.go):

1. `X-Claude-Code-Session-Id` (first, so a Claude Code client wins over everything below)
2. Claude Code `metadata.user_id` session
3. `Session-Id` / `Session_id`
4. `X-Session-ID`
5. `X-Session-Affinity` (OpenCode)
6. `X-Client-Request-Id` (pi)
7. `session_id` / `sessionId`
8. `prompt_cache_key` (`conversation` alias)
9. legacy `metadata.user_id` and `conversation_id` body fields
10. explicit execution session metadata
11. context-derived identity (Merkle LCP prefix matching; needs at least 2 shared trailing turns)
12. hash of the first messages

So Claude Code through the hub already supplies tier 1 with no extra header; `X-Session-ID` is only a fallback for clients
that lack it. The earlier local report suggested sending `X-Session-ID`; it ranks below the Claude Code header. Whether a
given Claude Code version always sends `X-Claude-Code-Session-Id` is not established by these sources; unconfirmed.

## 4. Local-cooldown 429 (issue 7417)

[Issue 7417](https://github.com/router-for-me/CLIProxyAPI/issues/7417), open at read time (opened 2026-11-10), no comments.
Reporter's claims, not maintainer-confirmed:

- On the first upstream 429 the Claude executor reads the `anthropic-ratelimit-unified-*` headers to compute the cooldown,
  then drops them; `passthrough-headers: true` (issue #6700) covers that part.
- Later requests get a locally produced 429 whose `modelCooldownError.Headers()` (selector.go) sets only `Retry-After`.
  Claude Code prints "Server is temporarily limiting requests (not your usage limit)" and emits no `rate_limit_event`.
  The reset time is in the message text ("reset after ...") since commit e458999 (#7285).
- Proposed fix: add `anthropic-ratelimit-unified-status`, `-reset`, `-representative-claim`, `-overage-status`, and the
  `-5h-*` or `-7d-*` fields on the cooldown 429, behind the same `passthrough-headers` gate. The claim is guessed from the
  remaining time (over 5 h means seven_day).
- Claude Code only treats the base URL as a gateway when `ANTHROPIC_AUTH_TOKEN` is a JWT with `"aud":"claude-gateway"`;
  a plain `sk-` key shows the generic error even with the headers.

Pane implication: do not parse the 429 body or headers for reset time; read `next_retry_after` from `GET /credentials`.
I did not verify any of the issue's claims against source beyond the `Headers()` location.

## 5. What EasyCLIProxyAPI exposes

From [README](https://github.com/router-for-me/EasyCLIProxyAPI/blob/main/README.md) ("manage ... routing strategy", "review
provider quotas and account availability") and the routing page source
([routing.ts](https://github.com/router-for-me/EasyCLIProxyAPI/blob/main/src/services/routing.ts),
[PolicyStrip.tsx](https://github.com/router-for-me/EasyCLIProxyAPI/blob/main/src/pages/routing/PolicyStrip.tsx)):

- Exposed: `strategy`, `session-affinity` toggle, `session-affinity-ttl` (validated as a Go duration), `request-retry`,
  `max-retry-credentials`, `max-retry-interval`, `disable-cooling`, `transient-error-cooldown-seconds`.
- Not found in those two files: `session-affinity-subagents`, `session-affinity-rebind-on`, `save-cooldown-status`.
  Other ECPA files were not searched, so treat as not confirmed absent.
- It also shows quota and account availability, and usage history (README). It manages only its own local core; its
  management client targets loopback (from the prior local report, not re-verified here).

## Unconfirmed

- Keys of `quota.signals` and the full `model_quotas` content for Claude credentials.
- Whether Claude entries carry the Codex-documented renewal fields (`requires_sign_in` etc.).
- Maintainer position on issue 7417.
- Whether the live core at the pinned version matches `main` for all of the above.
