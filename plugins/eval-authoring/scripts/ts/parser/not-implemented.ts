/**
 * Placeholder body for the stubs in this PR (#486). Each implementation PR
 * (#452 for the parser, #487 for the helpers) replaces its stubs and drops its
 * use of this.
 */
export const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet (see #452 and #487)`);
};
