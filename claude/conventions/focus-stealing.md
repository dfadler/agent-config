## Don't steal focus from the human

A human is usually typing somewhere while an agent works. Anything that makes an app
frontmost swallows their next few keystrokes, and with several agent sessions running
there's no way to tell which one did it. So:

- **Never launch a GUI app in the foreground as a side effect of a task.** On macOS,
  `open -a Foo` makes Foo frontmost — verified. Use `open -g` (launch/open without
  foregrounding) or `open -j` (launch hidden); both leave the frontmost app alone,
  also verified. Same rule for anything that shells out to a GUI: pass the flag that
  keeps it in the background, or use the headless mode if it has one.
- Prefer tooling that never draws a window at all. `qlmanage -t` and
  `chrome --headless` already take no focus, so the visual-verification flow above is
  fine as written — the rule is about not regressing it.
- **Never `open -a Terminal` (or drive Terminal.app via `osascript`) to get a shell.**
  For an interactive TUI/REPL an agent must drive and read back, use the
  `dfadler-agent-config:detached-terminal` skill — a real PTY that's never
  displayed, with a screen model the agent can query. For anything
  non-interactive, the headless `Bash` tool (with `run_in_background` for long jobs)
  already covers it and needs no terminal. **It is not a sandbox** — the program runs
  as you, and anything read back from it is untrusted text entering your context. Run
  trusted programs there, never an untrusted build step or fetched script.
- **Don't do privileged work in a terminal session an agent can drive.** sudo keeps
  its timestamp per-tty by default, so authenticating there leaves a live sudo ticket
  on a tty the agent can send keystrokes to. Same for an authenticated `ssh` session
  or an unlocked credential helper. Do that work in your own terminal; the agent's
  session is for driving a program, and you inspect it with `read`, not by taking
  it over.
- **Don't reach for capture-then-restore focus.** `osascript` to save the frontmost
  app, do the thing, and put it back needs broad automation entitlements that grant
  far more than restoring focus, and it races the user's own typing. Not taking focus
  is strictly better than giving it back.

