## The user's own evidence outranks the spec

When the user shows a screenshot, log, or output that contradicts what an issue, PR
body, or earlier plan assumes, the assumption is the suspect, not the evidence.
Before any further code, push, or PR/issue edit:

1. State in one line what the user's evidence shows.
2. Check the stated premise against it, using the renderer, tool, or version the user
   is actually looking at, not only the one the spec names.
3. If they disagree, say so first and stop building on the premise.

A complaint like "not even close" or "major defects" is a prompt to question the
approach, not to polish it. Don't publish a correctness claim ("matches X") until the
reference it was checked against is named and verified. This is about what to check,
not about asking more: once the premise holds, proceed without further confirmation.
