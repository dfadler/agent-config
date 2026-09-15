---
name: linux-administration
description: |
  First-party Linux system administration guidance for systemd-based
  distributions: package management (apt/dnf/pacman), systemd service
  management and diagnosis, filesystem operations, user/permission
  management, disk partitioning, network/firewall configuration
  (ufw/firewalld/nftables), and SSH hardening (sshd_config, authorized_keys).
  Sorts every command shape into one of three mechanical buckets — safe to
  run freely, needs explicit confirmation, or never run autonomously — the
  same categorical discipline `~/.claude/CLAUDE.md`'s "Action categories"
  applies generally, made concrete for sysadmin command shapes instead of a
  single "be careful with destructive commands" reminder. Also requires
  citing the relevant man page or official docs for any claim about how a
  specific command or unit behaves, since behavior varies by distro/version.
  Use before running, or advising the user to run, any Linux administration
  command — installing/removing packages, starting/stopping/enabling
  services, changing file ownership or permissions, managing users or
  groups, partitioning or formatting disks, or changing firewall/network
  configuration — on a systemd-based Linux host (local, remote/SSH, or a
  container). Does not cover non-systemd init systems (sysvinit, OpenRC,
  runit) or Windows/macOS administration.
license: MIT
metadata:
  version: "1.2.0"
---

# Linux administration

## Scope

**In scope**: systemd-based Linux distributions — Debian/Ubuntu (`apt`),
Fedora/RHEL/CentOS-family (`dnf`), and Arch (`pacman`) — since these cover
the large majority of Linux systems actually administered through an agent
session today (local dev boxes, cloud VMs, containers with a systemd PID 1).
Covers: package management, systemd unit/service management and failure
diagnosis, filesystem operations, user and permission management, disk
partitioning, network/firewall configuration (`ufw`, `firewalld`, raw
`nftables`/`iptables`), and SSH hardening (`sshd_config` directives,
`authorized_keys` management).

**Out of scope, explicitly**: non-systemd init systems (sysvinit, OpenRC,
runit, Alpine's default setup), BSD variants, and Windows/macOS
administration. A command shape below that doesn't exist on a given distro
(e.g. `ufw` on a RHEL-family host, which ships `firewalld` instead) simply
doesn't apply there — check which stack a given host actually runs (`systemctl
status ufw`/`firewalld`, `command -v ufw`) before assuming.

This is a deliberate v1 boundary, not a claim of universal coverage. If a
real task needs a non-systemd distro or a domain not listed above (SELinux
policy authoring, LVM/ZFS-specific management, containers-as-init), treat
that as new scope requiring its own review against this same bar — don't
silently stretch this skill to cover it.

## The three-tier action model

Every Linux administration command shape falls into exactly one bucket.
This mirrors `~/.claude/CLAUDE.md`'s "Action categories" (Prohibited /
Explicit permission required / Regular) rather than inventing a parallel
scheme — sysadmin work is just a domain where "Explicit permission
required" and "Prohibited" both need concrete, command-level content
instead of staying abstract.

### Tier 1 — Safe: run freely, no confirmation needed

Read-only or purely diagnostic. These never mutate state, so there is
nothing to confirm.

- **Service/process status**: `systemctl status|list-units|list-unit-files|is-active|is-enabled`,
  bounded `journalctl` reads (`--since`/`--until`, or `-n <N>`) — not bare
  `-f`/`--follow`, which streams indefinitely and can hang an agent
  workflow waiting for it to end — `ps`, a bounded `top -b -n 1`/single
  `htop` snapshot (not an interactive, unbounded session), `pgrep`. Route a
  genuinely interactive `top`/`htop`/`journalctl -f` session through
  `dfadler-agent-config:detached-terminal` instead of treating it as Tier 1.
- **Package queries**: `apt list|search|show`, `apt-cache policy`,
  `apt update` (refreshes the package index only — installs/upgrades
  nothing), `dnf list|info|repoquery`, `dnf check-update`, `dpkg -l|-s`,
  `rpm -qa|-qi`, `pacman -Q|-Si`. **Not** `pacman -Sy` — see the
  package-manager quick reference below for why a standalone sync is
  unsafe on Arch specifically.
- **Filesystem/disk queries**: `df`, `du`, `lsblk`, `blkid`, `fdisk -l`
  (list-only), `parted <device> print`, `stat`, `find` restricted to
  search/print/stat predicates — excludes every execution action, not just
  `-delete`/`-exec rm`: no `-exec`/`-execdir` of any kind, since those can
  run `chmod`, `chown`, a shell, or a network client just as easily as
  `rm` — `file`.
- **Network/firewall queries**: `ip addr|route|link show`, `ss`, `netstat`,
  `ufw status`, `firewall-cmd --list-all|--state`, `iptables -L`/`nft list
  ruleset`.
- **Identity queries**: `id`, `whoami`, `groups`, `getent passwd|group`,
  `last`, `w`.
- Reading non-secret config files (`cat`/`less`/`grep` over `/etc/**`, unit
  files, logs) — **except** credential-bearing paths (`/etc/shadow`,
  `/etc/gshadow`, `/etc/sudoers` and `/etc/sudoers.d/**`,
  `/etc/ssh/ssh_host_*_key`, or any other `/etc/**` path holding a private
  key, API token, or password): reading one of those puts its contents in
  the session's context, so treat it as Tier 2 — state the specific path
  and why before reading it.

### Tier 2 — Needs explicit confirmation: state-changing but scoped

Mutates the system, but the blast radius is a single named unit, package,
file, user, or rule — reversible or at least narrowly contained. Follow
this repo's `gh-publish-permission` pattern: state exactly what will run
(the command, the target) and get an explicit go-ahead before running it,
same as any other "Explicit permission required" action.

- **Package management — targeted**: `apt install|remove|purge <pkg>`,
  `dnf install|remove <pkg>`, `pacman -S|-R <pkg>` — one or more named
  packages, not the whole system.
- **Package management — full-system upgrade**: `apt upgrade`/`apt
  full-upgrade`, `dnf upgrade` (no package argument), `pacman -Syu`. These
  upgrade every installed package, not a bounded target — when asking for
  the go-ahead, say so explicitly (system-wide blast radius, not one
  package) rather than describing it as if it were scoped like the
  targeted case above.
- **Fetch-and-execute installs** (`curl <url> | sh`, `curl <url> | sudo
  bash`, an install script piped straight into a shell): governed by the
  `dfadler-agent-config:fetch-execute-permission` skill, not this skill's
  own tiering — that skill's per-run, exact-command permission gate applies
  here unchanged, so this is Tier 2 (confirmation-required), not Tier 3.
  Root/sudo context (`curl <url> | sudo bash`) raises the stakes further:
  say so explicitly when asking, and treat the request as void if the
  actual command differs even slightly from what was approved.
- **Service management**: `systemctl start|stop|restart|reload|enable|disable
  <unit>` for one named unit.
- **Filesystem**: creating/removing/moving a specific, named file or
  directory outside a designated scratch area; `rm <specific-path>`
  (non-recursive, non-wildcard, outside scratch); mounting/unmounting one
  named filesystem.
- **Users/permissions**: `useradd|usermod|userdel <user>` for a non-system
  account (UID ≥ 1000, per the distro's `/etc/login.defs` `UID_MIN` — verify
  the actual threshold on the host rather than assuming 1000, since it's
  configurable); `usermod -aG <group> <user>`; `chmod`/`chown` on a single,
  named file or directory (no `-R` — see Tier 3 for the recursive form).
- **Network/firewall**: adding or removing one specific rule — `ufw
  allow|deny <port/service>`, `firewall-cmd --add-port=<port>/<proto>
  [--permanent]`, `nft add rule ...` for a single rule; changing config for
  one named network interface.
- **SSH hardening**: editing one directive in `/etc/ssh/sshd_config` (or a
  drop-in under `/etc/ssh/sshd_config.d/`) — e.g. `PasswordAuthentication
  no`, `PermitRootLogin no`, changing `Port` — validated with `sshd -t`
  before reloading; adding a public key to an existing user's
  `~/.ssh/authorized_keys`. These are Tier 2 on their own, but see the
  Tier 3 rule below on cutting off session access: a change to the auth
  method or listening config the *current* session depends on needs a
  confirmed second access path or rollback, not just a go-ahead on the
  edit itself.
- **Disk**: creating a new partition on confirmed-unused space; running
  `mkfs` on a partition just created and confirmed empty; resizing a
  filesystem after a confirmed backup exists.

### Tier 3 — Never run autonomously, even with a general "go ahead"

These map to this repo's "Prohibited" category: stop and tell the user to
run it themselves, even if they say "yes, do it" in general terms — a
sysadmin-specific instance still needs the same per-repo-defined scope of
explicit, request-scoped permission, and some of these should never be run
by an agent at all regardless of permission, per the global rule.

- **`rm -rf`** targeting anything outside an explicitly designated
  scratch/temp directory, or any `rm -rf /`-shaped invocation (including
  `rm -rf /*`, `rm -rf ~`, `rm -rf .` at a root-like cwd).
- **`dd`** with `of=` pointing at a block device (`/dev/sd*`, `/dev/nvme*`,
  `/dev/vd*`, `/dev/xvd*`, `/dev/mapper/*`) — a single wrong argument
  overwrites a disk with no confirmation prompt of its own and no undo.
- **Partition table changes on a disk already in use**: `fdisk`/`parted`/
  `gdisk` operations that delete, resize, or recreate an existing
  partition; `wipefs`; `parted ... mklabel` on a disk with existing data.
- **`chmod -R` / `chown -R` on broad system paths** — `/`, `/etc`, `/usr`,
  `/var`, `/home`, `/boot`, or any path that is itself one of those (not a
  single user's home subdirectory). Recursive permission/ownership changes
  at that scope routinely break package-manager assumptions and PAM/sudo,
  and are not realistically reversible.
- **Disabling a firewall entirely, or flushing all rules**: `ufw disable`,
  `systemctl stop ufw|firewalld` as a blanket disable, `iptables -F`
  (flush) or `iptables -P INPUT ACCEPT` as a policy-wide open, `nft flush
  ruleset`. A scoped rule change (Tier 2) is different from turning the
  firewall off.
- **Deleting a system account or root**: `userdel` on a UID below the
  distro's `UID_MIN`, or on `root`; directly editing `/etc/shadow` or
  `/etc/sudoers` with an editor/`sed` instead of `passwd`/`chage`/`visudo`
  (the latter validates syntax before saving; direct edits can lock out
  `sudo` entirely).
- **Anything that would cut off the current session's own access** without
  a confirmed rollback path — e.g. changing the SSH daemon's auth method
  or restarting `sshd` in a way that drops the auth method the current
  session is using, or a firewall rule that blocks the management
  connection currently in use — unless a second access path or a timed
  auto-revert is already confirmed and in place.
- **Entering a password** (root, sudo, or any account's) into any prompt,
  including `passwd`, `sudo -S`, or an expect-style script that supplies
  one — this is `~/.claude/CLAUDE.md`'s "Prohibited" credential-entry rule,
  restated here because sysadmin work is exactly where it comes up.

## Sourcing discipline

Before asserting how a specific command, flag, or systemd unit directive
behaves, check that tool's own man page or official docs rather than
answering from memory — behavior varies by distro and version (`apt`
14 vs. Debian's earlier version, `dnf` vs `dnf5`, systemd 253 vs. 257,
`ufw` on Ubuntu vs. a manually-installed copy elsewhere). This is the same
"Cite sources for platform-capability claims" convention `~/.claude/CLAUDE.md`
already requires generally, applied to sysadmin tooling specifically.

Practical ways to satisfy it, in order of preference:

1. `man <command>` or `<command> --help` **on the actual host being
   administered** — the authoritative source for that host's installed
   version, not a generic assumption.
2. The tool's own upstream docs when the host's man page is unavailable or
   the question is about a directive rather than a flag, e.g.:
   - systemd unit semantics: `systemd.unit(5)`,
     `systemd.service(5)` — https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html
   - `systemctl(1)` — https://www.freedesktop.org/software/systemd/man/latest/systemctl.html
   - `apt(8)` — https://manpages.debian.org/stable/apt/apt.8.en.html
   - `dnf` command reference — https://dnf.readthedocs.io/en/latest/command_ref.html
   - `ufw(8)` — https://manpages.ubuntu.com/manpages/noble/man8/ufw.8.html
   - `firewalld.cmd(5)` / `firewall-cmd(1)` — https://firewalld.org/documentation/
   - `parted` manual — https://www.gnu.org/software/parted/manual/parted.html
   - `dd` (GNU coreutils) — https://www.gnu.org/software/coreutils/manual/html_node/dd-invocation.html
3. If neither is checkable in the moment, say so explicitly ("this is my
   general understanding of `<tool>`; verify against `man <tool>` on this
   host before relying on it") rather than presenting an unverified,
   version-specific claim as settled fact.

Distro/package-manager flag differences are exactly where memory goes
stale fastest (an `apt` flag added in a later release, a `dnf`→`dnf5`
default change) — treat any such claim as needing the check above before
it goes into an actual command run against a real system.

## Procedure

1. Identify the command's tier (above) before running it or recommending
   it verbatim.
2. **Tier 1**: run it and report the result.
3. **Tier 2**: state the exact command and its target, then get an
   explicit go-ahead — the same explicit/request-scoped/specific bar
   `gh-publish-permission` applies to GitHub publish actions, applied here
   to a state-changing sysadmin command. Don't infer permission from a
   broader adjacent ask ("clean up this server" does not by itself
   authorize a specific `apt remove`).
4. **Tier 3**: refuse to run it yourself regardless of how the request is
   phrased, explain which Tier-3 bucket it falls into and why, and tell
   the user the exact command to run themselves if they still want to do
   it. This holds even if the user says "yes, I'm sure" or supplies every
   detail — per `~/.claude/CLAUDE.md`'s Prohibited-category handling, the
   answer is to state the rule and hand it back, not to comply.
5. When a command's tier is ambiguous (a `chown` whose recursion target
   turns out to be a symlink into `/etc`, a "temporary" directory that
   isn't actually scratch space), treat it as the higher tier until
   confirmed otherwise — err toward asking, not toward assuming safety.
6. **Don't bundle logically separate Tier 2 actions into one confirmation.**
   A request like "set up a new deploy user and open port 8080 for the app"
   contains two independent actions — user provisioning and a firewall
   change — that happen to arrive in the same sentence. Get a separate
   explicit go-ahead for each rather than listing every command and asking
   for one blanket yes. A single combined "yes" leaves it genuinely
   ambiguous whether the user weighed both parts or just the one they were
   thinking about, and it removes their ability to approve one now and hold
   off on the other. Steps that are only sub-parts of one coherent operation
   — `useradd deploy` immediately followed by `usermod -aG sudo deploy` to
   finish provisioning that same account — are one action and can share a
   single confirmation; the test is whether the pieces would make sense as
   separate asks on their own, not whether they happen to share a sentence.

## Diagnosing a failing or misbehaving service

A "why is X broken" or "X won't start" request is a Tier 1 diagnostic phase
followed by a Tier 2 fix, not a single step — resist naming the fix before
the diagnosis actually supports it, even when the symptom looks familiar.

1. **Status first**: `systemctl status <unit>`. This alone often names the
   failure directly (a crashed process, a failed config test, an unmet
   dependency) and tells you what to look at next, before touching logs at
   all.
2. **Bounded logs next, scoped to the unit**: `journalctl -u <unit> --since
   <window>` or `-n <N>` — not a bare `-f`/`--follow` (see Tier 1 above),
   and not an unscoped read of the entire system log when the unit name is
   already known. Widen the time window only if the first read doesn't
   explain it.
3. **State the diagnosis before proposing the fix.** "The status output
   shows `(dead) failed` and the log shows a syntax error at
   `nginx.conf:12`, so the fix is correcting that line and reloading" is a
   diagnosis someone can check against the evidence. "Let's restart it and
   see" is a guess wearing a diagnosis's clothes — it may work, but it
   didn't come from reading the evidence, and Tier 2's "state the exact
   command and target" requirement means the target should follow from
   what was actually found, not from the symptom alone.
4. **Apply the Tier 2 procedure for the fix itself** (state the command,
   get the go-ahead, run it), **then re-check** status/logs afterward to
   confirm the fix actually took — `active (running)` immediately after a
   config reload doesn't yet prove the underlying problem is gone if the
   failure was intermittent or config-validation-only; re-reading the same
   status/log source you diagnosed from is what closes the loop.

## Package-manager quick reference

Command shapes are equivalent across these three, but flags and defaults
are not identical — verify against the sourcing discipline above rather
than assuming a direct translation, especially for anything beyond
install/remove/search:

| Action | Debian/Ubuntu (`apt`) | Fedora/RHEL (`dnf`) | Arch (`pacman`) |
|---|---|---|---|
| Install | `apt install <pkg>` | `dnf install <pkg>` | `pacman -S <pkg>` |
| Remove | `apt remove <pkg>` (keeps config) / `apt purge <pkg>` | `dnf remove <pkg>` | `pacman -R <pkg>` |
| Search | `apt search <term>` | `dnf search <term>` | `pacman -Ss <term>` |
| List installed | `dpkg -l` | `rpm -qa` | `pacman -Q` |
| Update index only | `apt update` (Tier 1) | `dnf check-update` (Tier 1) | not supported standalone — see note below |
| Upgrade all | `apt upgrade` (Tier 2, full-system) | `dnf upgrade` (Tier 2, full-system) | `pacman -Syu` (Tier 2, full-system) |

**Never run `pacman -Sy` on its own.** Unlike `apt update`/`dnf
check-update`, which only refresh metadata, Arch's own docs treat a
database sync with no immediately-following upgrade as an unsupported
partial-upgrade state that can break the system, because Arch's
rolling-release model assumes the local package database and installed
packages stay in sync (https://wiki.archlinux.org/title/System_maintenance).
Always pair it as `pacman -Syu`.

## Firewall stack quick reference

Check which stack a host actually runs before assuming — `ufw` and
`firewalld` are both front-ends over the kernel's `nftables`/`iptables`,
and only one is normally active at a time:

- **Debian/Ubuntu default**: `ufw`. Status: `ufw status verbose` (Tier 1).
  Scoped rule change: `ufw allow <port>/<proto>` (Tier 2). Full disable:
  `ufw disable` (Tier 3).
- **Fedora/RHEL default**: `firewalld`. Status: `firewall-cmd --state`,
  `firewall-cmd --list-all` (Tier 1). Scoped rule change: `firewall-cmd
  --add-port=<port>/<proto> --permanent && firewall-cmd --reload` (Tier 2).
  Full disable: `systemctl stop firewalld` as a blanket measure, or
  `firewall-cmd --add-interface=... --zone=trusted` opening everything
  (Tier 3).
- **Raw `nftables`/`iptables`** (no front-end, or scripting one directly):
  listing rules is Tier 1; adding one scoped rule is Tier 2; `flush`ing a
  table/chain or setting an `ACCEPT` default policy on `INPUT` is Tier 3.

## SSH hardening quick reference

`sshd`'s config lives in `/etc/ssh/sshd_config` (plus any drop-ins under
`/etc/ssh/sshd_config.d/*.conf`, which are read in glob order and can
override the main file — check for a conflicting drop-in before assuming a
main-file edit is the only place a directive is set).

- **Check current settings** (Tier 1): `sshd -T | grep -i <directive>`
  reports sshd's actual *effective* config after all includes are applied —
  more reliable than grepping the raw file, which won't show a drop-in
  override.
- **Edit one directive, then validate before reloading** (Tier 2):
  `sshd -t` (or `sshd -t -f <file>` to check a drop-in in isolation) parses
  the config and reports syntax errors without affecting the running
  daemon — always run it after editing and before
  `systemctl reload sshd`, since a reload with a broken config can leave
  the daemon in a bad state.
- **Reload, don't restart, for a config-only change**: `systemctl reload
  sshd` re-reads config without dropping existing connections;
  `systemctl restart sshd` does drop them. Prefer reload unless the change
  specifically requires a full restart.
- **The session-continuity rule (Tier 3) applies directly here**: disabling
  password auth, changing the port, or restarting in a way that drops the
  current session's own auth method or connection needs a confirmed second
  access path (a second open session, console/out-of-band access, a
  provider's rescue mode) or a timed auto-revert before it runs — "it
  validated with `sshd -t`" proves the config is syntactically valid, not
  that it won't lock out the session applying it.
