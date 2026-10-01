import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

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
