// Dev-only: `node --import ./scripts/dev/register-alias.mjs …` resolves the app's `@/` imports (see alias-hooks.mjs).
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
