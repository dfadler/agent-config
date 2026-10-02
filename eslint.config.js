import functional from "eslint-plugin-functional";
import tseslint from "typescript-eslint";

// The functional "core": pure, immutable code. Add a directory here to opt it
// in. Everything else (CLI entry points, I/O shells) keeps the base rules only.
const CORE_FILES = ["scripts/ts/lib/**/*.ts"];
const CORE_TESTS = ["scripts/ts/lib/**/*.test.ts"];

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type assertions and non-null `!` hide bugs the compiler would catch;
      // narrow or validate at the boundary instead.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      // Not part of strictTypeChecked; a new union member must break every
      // switch that forgot it.
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: CORE_FILES,
    plugins: { functional },
    rules: {
      "functional/immutable-data": "error",
      "functional/no-let": "error",
      "functional/no-loop-statements": "error",
      "functional/no-classes": "error",
      "functional/no-class-inheritance": "error",
      "functional/no-this-expressions": "error",
      // Errors are values (Result); the few boundary throws carry a disable.
      "functional/no-throw-statements": "error",
      "functional/prefer-property-signatures": "error",
      "functional/type-declaration-immutability": "error",
      "functional/prefer-immutable-types": [
        "error",
        { enforcement: "ReadonlyShallow" },
      ],
      "prefer-const": "error",
      "no-param-reassign": ["error", { props: true }],
    },
  },
  {
    // Tests assert behavior and legitimately build mutable fixtures and throw.
    files: CORE_TESTS,
    rules: {
      "functional/no-throw-statements": "off",
      "functional/immutable-data": "off",
      "functional/prefer-immutable-types": "off",
    },
  },
);
