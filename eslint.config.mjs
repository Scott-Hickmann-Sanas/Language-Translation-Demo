import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";

const eslintConfig = [
  eslint.configs.recommended,
  {
    files: ["**/*.{ts,js}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
        ecmaFeatures: {
          jsx: false,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        ...globals.jest,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      prettier,
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",
      "prettier/prettier": ["warn"],
      "no-redeclare": "off",
      "linebreak-style": "off",
      camelcase: "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Note: @typescript-eslint/camelcase is deprecated
      // Use @typescript-eslint/naming-convention instead if needed
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "objectLiteralProperty",
          format: null,
        },
      ],
    },
  },
];

export default eslintConfig;
