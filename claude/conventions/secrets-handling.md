## Secrets handling

Treat env vars, tokens, API keys, session IDs, and credentials as sensitive data in
this agent's own output — logs, commits, PR/issue bodies and comments, error
messages — separate from credential *entry* and command-execution consent, which the
environment's own permission system already governs:

- Never commit a secret. Redact or mask secrets in logs, errors, tool output, and
  anything posted publicly (PR/issue bodies, comments).
- Avoid echoing headers that carry credentials, such as `Authorization`, `Cookie`,
  `Set-Cookie` (response), or `Proxy-Authorization`, even while debugging.
- If exposure is suspected — a secret shows up in a diff, a log, or output about to be
  posted — rotate the credential immediately and note the remediation rather than
  just scrubbing the visible copy.

