#!/usr/bin/env bash
# Scaffold for flaky-tests-repro-ladder-actions: creates ./bin/pnpm, a shim that
# prints canned Vitest output so the case is deterministic and needs no install or
# network. It never runs Vitest. A literal `--` argument is dropped along with the
# flags after it, matching how pnpm's script forwarding was observed to behave.
set -euo pipefail

mkdir -p bin
cat >bin/pnpm <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
seed="812345"
shuffle=0
for a in "$@"; do
  case "$a" in
    --) echo "WARN: flags after -- were ignored"; break ;;
    --sequence.shuffle*) shuffle=1 ;;
    --sequence.seed=*) seed="${a#*=}" ;;
  esac
done
echo " RUN  v5.0.2 (canned output; no tests were executed)"
echo "      Running tests with seed \"$seed\""
echo " FAIL  src/queue.test.ts > drains the queue in order"
echo " Test Files  1 failed (1)"
exit 1
SHIM
chmod +x bin/pnpm
