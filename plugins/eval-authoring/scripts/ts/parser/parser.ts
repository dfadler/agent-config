/**
 * The shared parser (#452). The implementation is split by concern; this file
 * keeps the original module path (and the frozen exports) stable.
 */
export { getSchema } from "./schema.ts";
export { parseAllowedTool } from "./tools.ts";
export { isScored, scoreCase, graderCategory } from "./scoring.ts";
export {
  readGrantsFile,
  grantsForCase,
  checkGrantCaseNames,
  grantSet,
  GRANTS_SCHEMA_VERSION,
} from "./grants.ts";
export { readAggregateResult, RESULT_SCHEMA_VERSION } from "./result.ts";
export {
  readCase,
  readSuite,
  resolveEvalDir,
  type EvalDirOptions,
} from "./case.ts";
