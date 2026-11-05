---
name: docker
description: |
  ALWAYS invoke before writing, reviewing, debugging or running anything with Docker, even
  when only asked for a plan or a command list: a Dockerfile, .dockerignore, compose.yaml,
  a failing `docker build`, a container that exits or restarts, or freeing disk with
  `docker prune`, `rm` or `compose down -v`. Returns Dockerfile and Compose rules cited to
  docs.docker.com, a read-only diagnosis order, and command permission tiers. Not for
  Kubernetes, Podman, Docker Desktop setup or GitHub Actions docker steps.
metadata:
  version: "1.0.0"
---

# Docker

## Contract

- **Input:** a Dockerfile, Compose file, `docker` command, container symptom or disk
  question.
- **Output:** a Dockerfile or Compose change that follows the rules below with the
  docs.docker.com link for each rule applied; a diagnosis that names the evidence; or the
  tier of each `docker` command (per Command tiers) and the exact command awaiting a
  go-ahead. Every claim in
  the reply about what a command, flag or instruction does carries its docs.docker.com
  link.
- **Does not:** run a command in the Ask or Hand-back tiers without the permission that
  tier requires, or cover Kubernetes, Podman, Docker Desktop installation, or `docker/*`
  actions in workflows (use `gha-workflow-authoring`).

## Command tiers

<!-- tier-policy:start -->
Sort every command into one tier before running or recommending it: run freely
(read-only), ask first (state the exact command and its target, then wait for a
go-ahead), or hand back (never run it yourself; name the tier, say why, and give the
user the command). A command that sits between two tiers takes the higher one. Hand
back stays hand back even when the user says "go ahead".
<!-- tier-policy:end -->

This section is the one place that decides whether a `docker` command is run, asked about
or handed back; other sections point here. A command no
tier lists is Ask first. The tiers gate running: a command or file you only write for the
user to apply is not run, but you still name its tier and follow Runtime hardening.

### Run freely (read-only)

`docker ps -a`, `docker images`, `docker inspect`, `docker system df`,
`docker compose config`, `docker compose ps`, `docker top`, `docker stats --no-stream`
([docker stats](https://docs.docker.com/reference/cli/docker/container/stats/)),
`docker scout cves <image>`, which analyzes an image for known vulnerabilities (report the
findings and the base-image change that would remove them;
[docker scout cves](https://docs.docker.com/reference/cli/docker/scout/cves/)), and
`docker logs` or `docker compose logs` with `--tail <N>` or `--since <duration>` (never
bare `-f`, which follows the log
([docker compose logs](https://docs.docker.com/reference/cli/docker/compose/logs/))).
Output over about 50 lines goes through `--tail` or a pipe to a file in the scratchpad,
and you summarise it.

### Ask first

State the exact command and its target, then wait for a go-ahead: `docker run`,
`docker exec`, `docker build`, `docker pull`, `docker push`, `docker stop|restart|kill`,
`docker rm <named container>`, `docker rmi`, `docker image prune`, `docker builder prune`,
`docker compose up|down|restart`, and edits to a Dockerfile (a base-image change from a
scout report included), `.dockerignore`, Compose file or `daemon.json`. Ask once per
independent action, not once for a batch. Running `--cap-add` is this tier too: name each
capability and why the service needs it.

Three more need the same go-ahead plus a one-line statement of the risk, because each
widens what a container can do to the host:
- `--privileged` and `--security-opt seccomp=unconfined`. `--privileged` grants
  all capabilities, disables the default seccomp and AppArmor profiles and exposes host
  devices ([docker run](https://docs.docker.com/reference/cli/docker/container/run/)).
- Mounting `/var/run/docker.sock` into a container, in `docker run` or `compose.yaml`. It
  gives full control of the host daemon, and docker-group membership is root-equivalent
  ([docker run](https://docs.docker.com/reference/cli/docker/container/run/),
  [post-install](https://docs.docker.com/engine/install/linux-postinstall/)).
- Running `docker-bench-security`. Its documented container command uses `--net host
  --pid host --userns host` and mounts the socket
  ([README](https://github.com/docker/docker-bench-security/blob/master/README.md)).

### Hand back (never run it yourself)

Anything that can delete volume data: `docker volume rm|prune`, `docker system prune`
with `--volumes`, `docker compose down -v` (or `--volumes`), and `docker rm -v`, which
removes the container's anonymous volumes
([docker container rm](https://docs.docker.com/reference/cli/docker/container/rm/)). Also a bind mount of
`/`. Tell the user which tier applies, why,
and the command to run themselves, even if they said "go ahead".

- `down -v` removes the named volumes declared in the Compose file and the anonymous
  volumes attached to containers; plain `down` keeps named volumes
  ([docker compose down](https://docs.docker.com/reference/cli/docker/compose/down/)).
- `docker system prune` removes stopped containers, unused networks, dangling images and
  unused build cache, asks for confirmation unless `-f` is passed, and removes anonymous
  volumes only with `--volumes`
  ([docker system prune](https://docs.docker.com/reference/cli/docker/system/prune/)).
- `docker volume prune` removes only anonymous volumes unless `--all` is given
  ([docker volume prune](https://docs.docker.com/reference/cli/docker/volume/prune/)).

For a "free up disk" request, run `docker system df` first, report what is reclaimable,
and put each prune in its tier under Command tiers; never answer with one `system prune -a --volumes`.

## Dockerfile rules

1. **Order layers from least to most frequently changed.** Copy the dependency manifest,
   install, then copy the source, so a source edit does not rerun the install. A changed
   layer invalidates every later layer
   ([cache invalidation](https://docs.docker.com/build/cache/invalidation/)).
2. **Run `apt-get update` and `apt-get install` in one `RUN`**, and remove
   `/var/lib/apt/lists` in that same instruction
   ([apt-get](https://docs.docker.com/build/building/best-practices/#apt-get)).
3. **Use a multi-stage build** so the final stage holds only what runs the app and not
   the compilers or build tools
   ([multi-stage](https://docs.docker.com/build/building/best-practices/#use-multi-stage-builds)).
4. **Pin the base image.** Tags are mutable; `image:tag@sha256:<digest>` always resolves
   to the same image. A digest pin opts out of automatic security fixes, so say how the
   digest gets updated (Dependabot's `docker` ecosystem or a Docker Scout policy)
   ([pin base image versions](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions)).
   Never `latest` as a base.
5. **Run as a non-root user** when the service needs no privileges: create the user and
   group in a `RUN`, give them an explicit UID/GID, set `USER`, and do not install `sudo`
   ([USER](https://docs.docker.com/build/building/best-practices/#user)).
6. **Add a `.dockerignore`** at the root of the build context so `.git`, `node_modules`,
   `.env` and build output stay out of the context
   ([dockerignore files](https://docs.docker.com/build/concepts/context/#dockerignore-files)).
7. **Prefer `COPY` to `ADD`** (use `ADD` only for remote artifacts or auto-extracting a
   tarball), and write `CMD` and `ENTRYPOINT` in exec form (`["executable", "arg"]`)
   ([ADD or COPY](https://docs.docker.com/build/building/best-practices/#add-or-copy),
   [CMD](https://docs.docker.com/build/building/best-practices/#cmd)).
8. **Never pass a secret through `ARG` or `ENV`:** both persist in the final image. Use
   `RUN --mount=type=secret,id=<name>` and `docker build --secret id=<name>,src=<path>`
   ([build secrets](https://docs.docker.com/build/building/secrets/)). Max-mode provenance
   attestations embed build-arg values, and `docker/build-push-action` uses max mode on
   public GitHub repositories, so a secret passed as a build arg can be published
   ([attestations](https://docs.docker.com/build/ci/github-actions/attestations/)).
9. **Mount package-manager caches** with `RUN --mount=type=cache,target=<dir>` instead of
   a layer that keeps them. The build must still work with an empty cache
   ([cache mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypecache)).
10. **Add a `HEALTHCHECK`** for a long-running service so Docker can tell a hung process
    from a working one
    ([HEALTHCHECK](https://docs.docker.com/reference/dockerfile/#healthcheck)).

Check: for each rule, point at the Dockerfile line that satisfies it or say which rule it
breaks. Do not call a rule satisfied without reading the line.

## Compose rules

1. **Name the file `compose.yaml`** and omit the top-level `version:` key; it is only
   informative and prints an obsolete warning. `docker-compose.yml` works for backward
   compatibility only
   ([version](https://docs.docker.com/reference/compose-file/version-and-name/),
   [Compose file](https://docs.docker.com/compose/intro/compose-application-model/)).
2. **Make startup order wait for health:** short-form `depends_on` only waits for the
   dependency to start; use the long form with `condition: service_healthy` and give that
   service a `healthcheck`
   ([depends_on](https://docs.docker.com/reference/compose-file/services/#depends_on)).
3. **Bind published ports to loopback unless the service must be public:**
   `127.0.0.1:8080:80`, not `8080:80`, which publishes on all host addresses
   ([port publishing](https://docs.docker.com/engine/network/port-publishing/)).
4. **Keep sensitive values out of `environment:`.** Use Compose secrets
   ([environment best practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/)).
5. **Validate with `docker compose config`** after every edit. It renders the merged,
   interpolated model and fails on an invalid file
   ([docker compose config](https://docs.docker.com/reference/cli/docker/compose/config/)).

## Runtime hardening

Apply these to a `docker run` command or a Compose service you write, and say which you
left out and why. Some images fail under them; add back only what a failure shows is
needed ([OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html),
[docker run](https://docs.docker.com/reference/cli/docker/container/run/)).

1. **Drop capabilities:** `--cap-drop all` (Compose `cap_drop: [ALL]`), then `--cap-add`
   only the ones the service needs. Writing this command is not gated; running it is Ask
   first under Command tiers.
2. **Set `no-new-privileges` explicitly:** `--security-opt no-new-privileges` (Compose
   `security_opt`). It is not on by default.
3. **Make the root filesystem read-only:** `--read-only` with `--tmpfs <path>` for each
   path the service writes (Compose `read_only: true` and `tmpfs`).
4. **Prefer rootless mode** for an untrusted or agent-driven workload: the daemon and
   containers run without root inside a user namespace. With `userns-remap` the daemon
   still runs as root
   ([rootless](https://docs.docker.com/engine/security/rootless/),
   [userns-remap](https://docs.docker.com/engine/security/userns-remap/)).

Version-specific: build attestations need Buildx 0.10 or later and BuildKit 0.11 or later,
and on the classic Engine image store with the `docker` driver they fail with
"Attestation is not supported for the docker driver"; enable the containerd image store or
use a `docker-container` builder
([attestations](https://docs.docker.com/build/metadata/attestations/)).

## Diagnosing a failing build or container

Run the steps in order, read-only, and stop at the first one that explains the failure.

1. Failing build: read the output of the failing instruction, not the whole log, and
   find the Dockerfile line that produced it.
2. Container that exits or restarts: `docker ps -a` for the status and exit code, and
   read the code before the logs. `docker run` reserves 125 (the Docker daemon failed),
   126 (the command cannot be invoked) and 127 (the command was not found); any other code
   is the container command's own, though a command can itself exit 125 to 127
   ([exit status](https://docs.docker.com/engine/containers/run/)). Exit code 137 means the
   process received SIGKILL
   ([docker container ls](https://docs.docker.com/reference/cli/docker/container/ls/)).
3. `docker logs --tail 100 <container>`; widen with `--since <duration>` only if that
   does not explain it
   ([docker container logs](https://docs.docker.com/reference/cli/docker/container/logs/)).
4. `docker inspect <container>` for mounts, networks, user and command; read the fields
   you need and do not paste the whole document.
5. Compose project: `docker compose config`, then `docker compose ps`.
6. Disk: `docker system df`
   ([docker system df](https://docs.docker.com/reference/cli/docker/system/df/)).

State the diagnosis with the evidence before proposing a fix: "exit 137 and the log ends
mid-build, so the process was killed", not "let's restart it". Apply the fix per Command
tiers, then rerun the step that diagnosed it to confirm the problem is gone.
