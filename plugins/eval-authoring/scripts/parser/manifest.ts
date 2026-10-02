/**
 * Stub for the plugin manifest reader (#487, Agent B). Replace the body; keep the
 * signature. Reads `name` and `dependencies` in all three forms. Used by EVAL018.
 */
import { notImplemented } from "./not-implemented.ts";
import type { PluginManifest } from "./types.ts";

/** Read `<pluginRoot>/.claude-plugin/plugin.json`. Never throws; problems land in `issues`. */
export const readPluginManifest: (pluginRoot: string) => PluginManifest = () =>
  notImplemented("readPluginManifest");
