import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default environment stays node so existing .test.ts files are unaffected.
    environment: "node",
    // .test.tsx files (React component tests) run under jsdom; .test.ts stay node.
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Runs for all test files. Importing jest-dom only augments `expect`; it is a
    // harmless no-op under node, so this does not affect the existing node tests.
    setupFiles: ["tests/setup-dom.ts"],
  },
  // Use React's automatic JSX runtime so component tests don't need to import
  // React explicitly. Applies only to JSX/TSX transform; plain .ts is untouched.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    // Components import via the `@/*` tsconfig path alias; mirror it so component
    // tests can resolve `@/lib/...` imports. Existing relative-import tests are
    // unaffected.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
