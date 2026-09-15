---
name: linux-administration
description: |
  First-party Linux system administration guidance for systemd-based
  distributions: package management (apt/dnf/pacman), systemd service
  management, filesystem operations, user/permission management, disk
  partitioning, and network/firewall configuration (ufw/firewalld/nftables).
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
  version: "1.0.0"
---

# Linux administration

## Why this exists

#214 investigated whether this repo should adopt a third-party Linux-admin
skill. #234 rejected both candidates found: low-star, single-day,
templated-bundle repos whose READMEs claimed "confirm before destructive
changes" but whose actual `SKILL.md` content was unenforced prose — a
checklist plus one safety-reminder line, no mechanical gate. This skill is
this repo's own replacement, held to the bar that decision set: safety
framing that is a mechanical classification of command *shapes* into
enforceable buckets, not a vague warning sentence, plus the same
sourcing/citation discipline `~/.claude/CLAUDE.md`'s "Cite sources for
platform-capability claims" already requires elsewhere in this repo.

## Scope

**In scope**: systemd-based Linux distributions — Debian/Ubuntu (`apt`),
Fedora/RHEL/CentOS-family (`dnf`), and Arch (`pacman`) — since these cover
the large majority of Linux systems actually administered through an agent
session today (local dev boxes, cloud VMs, containers with a systemd PID 1).
Covers: package management, systemd unit/service management, filesystem
operations, user and permission management, disk partitioning, and
network/firewall configuration (`ufw`, `firewalld`, raw `nftables`/
`iptables`).

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
  `journalctl` (read, including `-f`/`--since`), `ps`, `top`/`htop`,
  `pgrep`.
- **Package queries**: `apt list|search|show`, `apt-cache policy`,
  `dnf list|info|repoquery`, `dpkg -l|-s`, `rpm -qa|-qi`, `pacman -Q|-Si`.
- **Filesystem/disk queries**: `df`, `du`, `lsblk`, `blkid`, `fdisk -l`
  (list-only), `parted <device> print`, `stat`, `find` (search, no
  `-delete`/`-exec rm`), `file`.
- **Network/firewall queries**: `ip addr|route|link show`, `ss`, `netstat`,
  `ufw status`, `firewall-cmd --list-all|--state`, `iptables -L`/`nft list
  ruleset`.
- **Identity queries**: `id`, `whoami`, `groups`, `getent passwd|group`,
  `last`, `w`.
- Reading config files (`cat`/`less`/`grep` over `/etc/**`, unit files,
  logs).

### Tier 2 — Needs explicit confirmation: state-changing but scoped

Mutates the system, but the blast radius is a single named unit, package,
file, user, or rule — reversible or at least narrowly contained. Follow
this repo's `gh-publish-permission` pattern: state exactly what will run
(the command, the target) and get an explicit go-ahead before running it,
same as any other "Explicit permission required" action.

- **Package management**: `apt install|remove|purge <pkg>`,
  `apt upgrade`/`dnf upgrade` (a bounded, named upgrade — not a
  system-wide unattended one on a production host), `dnf install|remove
  <pkg>`, `pacman -S|-R <pkg>`.
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
- **Fetch-and-execute installs** (`curl <url> | sh`, `curl <url> | sudo
  bash`, an install script piped straight into a shell) — covered by the
  `fetch-execute-permission` skill; the same per-run permission gate
  applies here, with root/sudo context raising the stakes further.

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
| Update index | `apt update` | `dnf check-update` | `pacman -Sy` |
| Upgrade all | `apt upgrade` | `dnf upgrade` | `pacman -Syu` |

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
