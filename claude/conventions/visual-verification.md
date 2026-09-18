## Visual verification on PRs/issues that change rendered output

When a change (PR or issue) alters what gets visually rendered — UI components, generated images/diagrams, styled documents, anything a human would look at rather than just read as code — provide before/after screenshots in the PR or issue description, not just a prose description of the change. Skip this for changes that don't affect rendered output: backend logic, config, migrations, scripts, tests, types, docs, tooling.

Do this proactively, without waiting to be asked — treat it as part of finishing the PR, the same way running the test suite is.

For the actual capture mechanics — rendering before/after, converting to PNG, cropping to content, uploading, formatting the PR/issue body, verifying the images resolve, and avoiding a false negative from shared-page style leakage or host-context-only effects — see the `dfadler-agent-config:pr-visual-capture` skill. This section owns the policy of *when* verification is required; that skill owns *how* to produce it.

For a change that specifically touches layout, CSS, or responsive behavior, a screenshot at one fixed width isn't sufficient proof — it can look fine while missing overflow, clipping, or dead space that only shows up at a different viewport width. Do a manual resize pass across representative breakpoints plus a Lighthouse mobile/desktop CLI pass as part of the same verification; see the `pr-visual-capture` skill's "Responsive/viewport verification pass" section for the exact breakpoints, what counts as broken, and the Lighthouse CLI invocation.

