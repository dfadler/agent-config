import {
  readPluginManifest,
  resolveCasePath,
  type PluginDependency,
} from "../../parser/index.ts";
import type { Problem, Rule } from "../types.ts";

/**
 * Not from the docs: the plugin-evals docs say only that other plugins are
 * absent in a run and are silent on `dependencies`. This is observed behavior.
 */
const OBSERVED =
  "observed behavior in a logged-in eval run (#450), not the plugin-evals docs: a declared dependency is not resolved, so a plugin whose dependency is absent is silently dropped, and a plugins: entry outside the plugin under test fails to load";

const describeDependency = (dep: PluginDependency): string =>
  dep.marketplace === undefined ? dep.name : `${dep.name}@${dep.marketplace}`;

/**
 * EVAL018: dependencies of the plugin under test must be loaded by the case's
 * `plugins:` field, and every `plugins:` entry must stay inside the plugin.
 *
 * Both checks are lexical, like `resolveCasePath`: a symlink inside the plugin
 * that points elsewhere counts as inside, and whether the CLI accepts one is
 * unverified (#449). A dependency is matched by manifest `name` only, so a
 * version or marketplace on the dependency is not compared.
 */
export const rule: Rule = {
  id: "EVAL018",
  severity: "error",
  title:
    "A declared dependency is not loaded by the case's plugins:, or a plugins: entry is outside the plugin (observed, not documented)",
  source: OBSERVED,
  checkCase: (c, { pluginRoot, manifest }) => {
    const entries = c.plugins.value.map((entry) => ({
      entry,
      path: resolveCasePath(c.dir, entry, pluginRoot),
    }));

    const outside: readonly Problem[] = entries
      .filter((e) => !e.path.insidePluginRoot)
      .map((e) => ({
        message: `Case '${c.name.value}' has plugins entry '${e.entry}', which resolves to ${e.path.resolved}, outside the plugin under test. At run time this fails with "outside the containment root" and the case does not load (0 cases run). Basis: ${OBSERVED}. The containment check here is lexical: it does not follow symlinks.`,
        fix: "Point plugins: at a plugin directory inside the plugin under test, relative to the case directory (for example \"../..\" for the plugin itself, and a vendored copy such as \"../../deps/<name>\" for a dependency).",
        loc: c.plugins.loc,
      }));

    // An entry counts for a dependency when its manifest name matches, even
    // one that is outside the root: that entry is reported above, once.
    const loadedNames = new Set(
      entries.flatMap((e) => {
        const name = e.path.exists
          ? readPluginManifest(e.path.resolved).name
          : undefined;
        return name === undefined ? [] : [name];
      }),
    );

    const unmet: readonly Problem[] = manifest.dependencies
      .filter((dep) => !loadedNames.has(dep.name))
      .map((dep) => ({
        message: `The plugin declares dependency '${describeDependency(dep)}' (${dep.loc.file}:${String(dep.loc.line)}), but case '${c.name.value}' has no plugins entry for a plugin directory named '${dep.name}'. The run will silently drop the plugin under test and score as if it were absent, with no warning in the console or the result JSON. Basis: ${OBSERVED}.`,
        fix: `Put a copy of '${dep.name}' inside the plugin directory (for example deps/${dep.name}) and add it to plugins: next to the plugin itself, as plugins: ["../..", "../../deps/${dep.name}"]. Or drop the dependency if nothing in the plugin calls it at runtime.`,
        loc: c.plugins.loc,
      }));

    return [...outside, ...unmet];
  },
};
