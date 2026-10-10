# docs-staleness-checker

A read-only subagent that checks whether a project's docs prose is still true:
stale versions, moved paths, wrong counts, commands that no longer match their
script. It reports and never edits. See `agents/docs-staleness-checker.md`.

## Run it weekly

Docs drift when nothing prompts anyone to look, so schedule a pass. With the
`/schedule` skill (a cloud routine, one repo per routine):

```text
/schedule every Monday 09:00: In this repo, run the docs-staleness-checker agent
over CLAUDE.md, README.md and docs/. Report its findings ranked as it returns
them. Do not edit any file.
```

That is cron `0 9 * * 1`. The repo must have this plugin enabled so the routine
can dispatch the agent. Findings land in the routine's run output; turn them
into an issue or a fix yourself, so a scheduled run never publishes or edits on
its own. For a one-off pass, ask for "the docs staleness checker agent" in a
session. To scope a run, name the files in the prompt.
