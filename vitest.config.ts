import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@leadrwizard/shared": path.resolve(__dirname, "packages/shared/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/shared/src/**/*.ts"],
      exclude: ["**/index.ts", "**/types/**"],
    },
    server: {
      deps: {
        inline: [/@leadrwizard/],
      },
    },
  },
});
