## Background tasks: bound them, track them, stop them

A background task nobody stops runs until the machine does (a wait loop on a
container that never started ran 7 hours).

- **Bound.** Every wait loop and probe gets a hard deadline: a counted loop
  (`for i in $(seq 1 N); do …; sleep S; done`), not `until cond`. macOS has no
  `timeout`.
- **Track.** Background with `run_in_background`, never `( … ) &` or `nohup`: the
  harness tracks the former and notifies on exit, so you don't poll for "done".
  Send the output to a file and tell the user the task id and that path.
- **Stop.** A probe's job ends when it answers, and a hang is an answer. Stop it
  with `TaskStop` on its task id, not a bare `kill`. Never kill a process you did
  not start; if a stray one looks like it belongs to someone else, tell the user.
- **Session end.** Before wrap-up, `TaskStop` every background task you started
  that is no longer needed, and name any you leave running.
