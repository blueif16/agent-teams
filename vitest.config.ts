import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@/": new URL("./src/", import.meta.url).pathname },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // node:sqlite (src/server/runtime/db.ts) warns once per process that it is experimental in Node 24.
    execArgv: ["--disable-warning=ExperimentalWarning"],
  },
});
