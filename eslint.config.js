import path from "node:path";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

const engineEcmaGlobals = new Set(Object.keys(globals.es2026));
const engineSharedGlobals = new Set(["TextDecoder", "TextEncoder", "URL"]);
const engineRestrictedGlobals = [
  ...new Set([...Object.keys(globals.node), ...Object.keys(globals.browser)]),
].filter(
  (name) => !engineEcmaGlobals.has(name) && !engineSharedGlobals.has(name) && name !== "eval",
);
engineRestrictedGlobals.push("eval", "globalThis");
const engineTestRestrictedGlobals = engineRestrictedGlobals.filter(
  (name) => name !== "performance",
);
const engineSourceRoot = path.resolve(import.meta.dirname, "packages/engine/src");

function engineImportRestriction({ allowVitest = false } = {}) {
  return {
    patterns: [
      {
        regex: allowVitest ? "^(?!\\./|\\.\\./|vitest$).+" : "^(?!\\./|\\.\\./).+",
        caseSensitive: true,
        message: "The engine can import only relative paths; tests may also import vitest.",
      },
    ],
  };
}

function isWithinDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

const engineImportBoundaryPlugin = {
  rules: {
    "relative-imports": {
      meta: {
        type: "problem",
        docs: { description: "keep relative engine imports inside its source directory" },
        schema: [],
        messages: {
          outside: "Relative imports must resolve inside packages/engine/src.",
        },
      },
      create(context) {
        const filename = context.filename;
        function check(node, source) {
          if (typeof source !== "string" || !source.startsWith(".")) return;
          const resolved = path.resolve(path.dirname(filename), source);
          if (!isWithinDirectory(engineSourceRoot, resolved))
            context.report({ node, messageId: "outside" });
        }

        return {
          ImportDeclaration(node) {
            check(node.source, node.source.value);
          },
          ExportNamedDeclaration(node) {
            if (node.source) check(node.source, node.source.value);
          },
          ExportAllDeclaration(node) {
            check(node.source, node.source.value);
          },
          ImportExpression(node) {
            if (node.source.type === "Literal") check(node.source, node.source.value);
          },
          "CallExpression[callee.name='require']"(node) {
            const source = node.arguments[0];
            if (source?.type === "Literal") check(source, source.value);
          },
        };
      },
    },
  },
};

const engineRequireSyntax = [
  {
    selector: "CallExpression[callee.name='require']",
    message: "CommonJS require calls are not allowed in the engine.",
  },
  {
    selector: "CallExpression[callee.property.name='require']",
    message: "CommonJS require calls are not allowed in the engine.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/coverage/",
      "**/.data/",
      "apps/server/drizzle/",
      ".claude/",
      ".worktrees/",
      ".playwright-mcp/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  vue.configs["flat/recommended"],
  {
    languageOptions: {
      parserOptions: {
        // Vue files are parsed by vue-eslint-parser, which hands <script> blocks to this parser.
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["apps/web/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["apps/server/**", "e2e/**", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["scripts/**"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["packages/engine/src/**/*.ts"],
    plugins: { engine: engineImportBoundaryPlugin },
    rules: {
      "no-restricted-imports": ["error", engineImportRestriction()],
      "engine/relative-imports": "error",
      "no-restricted-globals": [
        "error",
        {
          globals: engineRestrictedGlobals,
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression", message: "Dynamic imports are not allowed in the engine." },
        ...engineRequireSyntax,
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    files: ["packages/engine/src/**/*.test.ts", "packages/engine/src/**/testing.ts"],
    rules: {
      "no-restricted-imports": ["error", engineImportRestriction({ allowVitest: true })],
      "no-restricted-globals": ["error", { globals: engineTestRestrictedGlobals }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression:not([source.type='Literal'][source.value='vitest'])",
          message: "Engine tests may dynamically import only vitest.",
        },
        ...engineRequireSyntax,
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      // Tests index into arrays they just built; a failed assertion reports a wrong index.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Matchers such as expect.any() are typed as any.
      "@typescript-eslint/no-unsafe-assignment": "off",
      // Assertions name mocked methods without calling them.
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
