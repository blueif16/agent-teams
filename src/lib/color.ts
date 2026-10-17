function parse(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Linear mix of two hex colors; t=0 returns a, t=1 returns b. */
export function mix(a: string, b: string, t: number): string {
  const ca = parse(a);
  const cb = parse(b);
  return (
    "#" +
    ca
      .map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, "0"))
      .join("")
  );
}
