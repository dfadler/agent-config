/** Shared citation text for rule `source` fields. */

/** The official plugin-evals docs, the basis for most rules. */
export const DOCS_URL = "https://code.claude.com/docs/en/plugin-evals";

/** `source` text for a rule whose basis is the docs, with what the docs say. */
export const fromDocs = (what: string): string =>
  `plugin-evals docs (${DOCS_URL}): ${what}`;
