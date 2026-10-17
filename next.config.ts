import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Agents' SOUL.md and MEMORY.md, and the skill library, are read at runtime, so ship them with the API routes.
  outputFileTracingIncludes: {
    "/api/**": ["./agents/**/*", "./skills/**/*"],
  },
  env: {
    AGENTS_BUILT_AT: new Date().toISOString(),
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
