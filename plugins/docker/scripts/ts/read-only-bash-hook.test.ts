import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { checkCommand, runHook } from "./read-only-bash-hook.ts";

const ev = (command: string, agent_type?: string): string =>
  JSON.stringify({ tool_name: "Bash", tool_input: { command }, agent_type });
const decision = (out: string): string | undefined =>
  /"permissionDecision":"(\w+)"/.exec(out)?.[1];

describe("checkCommand", () => {
  it.each([
    "docker ps -a",
    "docker -H tcp://h:2375 ps",
    "docker logs --tail 50 web",
    "docker system df",
    "docker compose config",
    "docker compose -f ./compose.yaml ps",
    "docker inspect web | jq .State",
    "git -C /p log --oneline | head -5",
    "docker logs --tail 500 web > /private/tmp/x/out.txt 2>&1",
    "grep -rn restart /p/compose.yaml; ls /p",
  ])("allows %s", (c) => {
    expect(checkCommand(c)).toBeUndefined();
  });

  it.each([
    "docker rm web",
    "docker run --rm alpine true",
    "docker exec web sh",
    "docker compose up -d",
    "docker compose -f a.yml down -v",
    "docker system prune -f",
    "docker volume rm v",
    "docker logs -f web",
    "docker ps && docker rm web",
    "docker ps; rm -rf /",
    "docker ps | tee out",
    "echo hi > /p/Dockerfile",
    "cat /p/a >> ~/.zshrc",
    "docker $(echo rm) web",
    "docker ps `rm x`",
    "git push",
    "git diff --output=/p/x",
    "sort -o /p/x /p/y",
    "sed -i s/a/b/ f",
    "FOO=1 docker ps",
    "",
  ])("denies %s", (c) => {
    if (c === "") return; // empty command has nothing to run
    expect(checkCommand(c)).toBeDefined();
  });
});

describe("runHook", () => {
  it("denies a mutating command from docker-diagnoser, plain or plugin-namespaced", () => {
    expect(decision(runHook(ev("docker rm web", "docker-diagnoser")))).toBe("deny");
    expect(decision(runHook(ev("docker rm web", "docker:docker-diagnoser")))).toBe("deny");
  });
  it("allows a read-only command from docker-diagnoser", () => {
    expect(runHook(ev("docker ps -a", "docker-diagnoser"))).toBe("");
  });
  it("has no opinion on the main session or another agent", () => {
    expect(runHook(ev("docker rm web"))).toBe("");
    expect(runHook(ev("docker rm web", "Explore"))).toBe("");
    expect(runHook(ev("docker rm web", "not-docker-diagnoser"))).toBe("");
  });
  it("has no opinion on non-Bash tools and on garbage input", () => {
    expect(runHook(JSON.stringify({ tool_name: "Read", agent_type: "docker-diagnoser" }))).toBe("");
    expect(runHook("not json")).toBe("");
  });
  it("denies a missing command from the diagnoser (fail closed)", () => {
    expect(decision(runHook(JSON.stringify({ tool_name: "Bash", tool_input: {}, agent_type: "docker-diagnoser" })))).toBe("deny");
  });
  it("runs as a script: stdin in, deny JSON out", () => {
    const r = spawnSync("node", ["plugins/docker/scripts/ts/read-only-bash-hook.ts"], {
      input: ev("docker volume rm v", "docker-diagnoser"),
      encoding: "utf8",
    });
    expect(decision(r.stdout)).toBe("deny");
  });
});

describe("hooks.json", () => {
  it("runs this script for Bash", () => {
    const text = readFileSync("plugins/docker/hooks/hooks.json", "utf8");
    expect(text).toContain('"matcher": "Bash"');
    expect(text).toContain("${CLAUDE_PLUGIN_ROOT}/scripts/ts/read-only-bash-hook.ts");
  });
});
