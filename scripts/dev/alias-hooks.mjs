/*
 * Dev-only module hooks so a script can import the app's TypeScript as Next does: `@/x` → src/x, and extensionless
 * relative imports → .ts / .tsx / index.ts. Registered by register-alias.mjs.
 */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../../src/", import.meta.url);
const TRY = ["", ".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, next) {
  let target = null;
  if (specifier.startsWith("@/")) target = new URL(specifier.slice(2), SRC);
  else if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    target = new URL(specifier, context.parentURL);
  }
  if (target) {
    const base = fileURLToPath(target);
    for (const ext of TRY) {
      const file = base + ext;
      if (existsSync(file) && statSync(file).isFile()) return next(pathToFileURL(file).href, context);
    }
  }
  return next(specifier, context);
}
