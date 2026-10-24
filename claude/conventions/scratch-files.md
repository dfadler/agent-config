## Scratch files go in the session scratchpad

When the environment names a scratchpad directory, write every temporary file there:
intermediate results, throwaway scripts, command output you want to keep, downloaded
or extracted data. Not `/tmp`, `$TMPDIR`, the working directory, or the project tree.
The scratchpad is session-specific and outside the checkout, so nothing leaks into a
commit or collides with another session.

- Pass the scratchpad path to every subagent or workflow prompt you write. They do not
  see it otherwise and fall back to `/tmp`.
- For a Bash command that creates temp files on its own (`mktemp`, `curl -o`), set
  `TMPDIR` to the scratchpad for that command, or give the path explicitly.
- Give a scratch file its full absolute path when you mention it to the user.
- A file the project needs (a fixture, a test, a doc) is not scratch: it belongs in
  the repo. Only the throwaway kind goes in the scratchpad.
- No scratchpad named in the environment? Default to `/tmp`: a fresh
  `mktemp -d /tmp/scratch.XXXXXX` directory (not bare `$TMPDIR`, which can point
  inside the checkout), cleaned up when done.

The `scratch-guard` plugin backs this up: a `PreToolUse` hook warns when `Edit`/`Write`
targets a system temp directory outside the scratchpad (`SCRATCH_GUARD=block` to refuse
instead, `off` to silence). It does not see Bash writes.
