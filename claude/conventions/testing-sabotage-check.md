## Testing: sabotage/mutation spot-check

A test that passes today isn't proof it would catch a real regression — an
implementation-coupled mock, a tautological assertion, or an existence-only check can
pass vacuously forever. Spot-check a new or modified test by temporarily breaking the
code under test (comment out the logic, early-return, flip a condition) and re-running
it: the test should fail. Revert the breakage immediately after confirming — this is a
manual verification step, not a change to ship. Apply it selectively (new/modified
tests, or ones you're suspicious of), not as a blanket pass over an existing suite.
This is cheap because it needs no mutation-testing tool, just the language's own
runner; #93 and #120's kcov/`check-shell-coverage.sh` work both used exactly this
technique to confirm bats coverage was real rather than incidental.

