## Scratch files go in the session scratchpad

When the environment names a scratchpad directory, write every temporary file there:
intermediate results, throwaway scripts, command output you want to keep, downloaded
or extracted data. Not `/tmp`, `$TMPDIR`, the working directory, or the project tree.
The scratchpad is session-specific and outside the checkout, so nothing leaks into a
commit or collides with another session.

- Give a scratch file its full absolute path when you mention it to the user.
- A file the project needs (a fixture, a test, a doc) is not scratch: it belongs in
  the repo. Only the throwaway kind goes in the scratchpad.
- No scratchpad named in the environment? Default to `/tmp`: a fresh
  `mktemp -d /tmp/scratch.XXXXXX` directory (not bare `$TMPDIR`, which can point
  inside the checkout), cleaned up when done.
