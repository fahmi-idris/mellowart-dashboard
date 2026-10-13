import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Standalone config (does NOT load vite.config.ts) so unit tests run in plain
// Node without the React Router / Cloudflare plugins. These suites cover pure
// logic only; binding-level tests can later use @cloudflare/vitest-pool-workers.
export default defineConfig({
  // Mirror the tsconfig `~/* -> ./app/*` path alias so server modules that
  // import siblings via `~/lib/...` resolve under vitest too.
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
