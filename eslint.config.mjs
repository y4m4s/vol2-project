import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["out/**", ".test-out/**", "node_modules/**"]
  },
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.webview.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error"
    }
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      // node:test の test() は PromiseLike を返すが、トップレベル登録は await しないのが正規の利用法。
      "@typescript-eslint/no-floating-promises": "off"
    }
  }
];
