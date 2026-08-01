import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 15_000,
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
