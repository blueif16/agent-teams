const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\/]/g, "\\$&");
const cache = new Map<string, RegExp>();

/** `*` matches any run of characters (dots and colons included); everything else is literal. */
export function globMatch(pattern: string, value: string): boolean {
  let re = cache.get(pattern);
  if (!re) {
    if (cache.size > 2000) cache.clear();
    re = new RegExp(`^${pattern.split("*").map(escapeRe).join(".*")}$`, "s");
    cache.set(pattern, re);
  }
  return re.test(value);
}
