import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "src/lib/{catalog,commerce-session,notification-feed,status,support-channels}.ts",
        "src/app/gift-cards/_lib/catalog-url.ts",
        "src/assistant/{engine,flows,validators,persistence}/**/*.ts",
      ],
      exclude: ["**/*.test.ts"],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
  },
});
