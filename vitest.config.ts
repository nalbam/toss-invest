import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // The project's tsconfig uses `jsx: "preserve"` (Next handles JSX at build
  // time), so Vite/oxc would otherwise leave JSX untransformed in the test
  // runtime. Force the automatic React JSX transform for `.tsx` test files.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` is a build-time marker that throws when bundled for the
      // client. In the Node test runtime it has no behaviour to exercise, so we
      // stub it to a no-op module.
      "server-only": fileURLToPath(
        new URL("./test/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Default environment is node; render tests opt into jsdom per file via a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    setupFiles: ["./test/setup-jest-dom.ts"],
  },
});
