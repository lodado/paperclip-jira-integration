import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
