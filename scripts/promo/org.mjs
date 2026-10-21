// The staged company for every capture (owner, 2026-10-20: "we can stage everything"). Real data underneath;
// only what's shown changes: professional channel names, duplicate test runs hidden, off-script messages dropped.
// Ids stay as they are, so every per-project request still finds its data.

/** team id → what the sidebar and headers show. */
export const TEAMS = {
  "bookbird-run-1": { channel: "bookbird-launch", name: "Bookbird launch page" },
  p_a02256fa71429065: { channel: "chronoshield-us-launch", name: "ChronoShield US launch" },
  p_282e5f03c6f4bfd2: { channel: "chronoshield-hardware", name: "ChronoShield hardware path" },
  p_138321a0e045aa0a: { channel: "guildhall-concept", name: "Guildhall community platform" },
  p_4de7ac093d23578d: { channel: "checkout-reliability", name: "Checkout reliability fixes" },
};
export const HIDDEN_TEAMS = ["bookbird-run-2", "bookbird-run-3"];

/** Display text rewrites inside API responses (messages, specs, state). Never ids. */
export const TEXT = [
  ["#bookbird-run-1", "#bookbird-launch"],
  ["Bookbird · Run 1", "Bookbird launch page"],
  ["Bookbird launch page (Run 1)", "Bookbird launch page"],
  ["#discord-competitor", "#guildhall-concept"],
  ["Discord competitor concept", "Guildhall community platform"],
  ["#merchant-bugfix-bench", "#checkout-reliability"],
  ["Merchant bug-fix benchmark", "Checkout reliability fixes"],
  ["#chronoshield-build-path", "#chronoshield-hardware"],
  ["ChronoShield build path", "ChronoShield hardware path"],
];

/** Transcript rows to drop, by exact text or prefix. */
export const DROP_MESSAGES = [/^hi$/i, /^Think of how we can do any better/, /^Hi\. I read the three run-1 deliverables/];

const rewrite = (s) => TEXT.reduce((acc, [a, b]) => acc.split(a).join(b), s);

/** Serves every GET /api/* (except streams and uploads) through the staged view. */
export async function polish(page) {
  await page.route(
    (url) => url.pathname.startsWith("/api/") && !/^\/api\/(events|runs|uploads)/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const res = await route.fetch();
      if (!(res.headers()["content-type"] ?? "").includes("json")) return route.fulfill({ response: res });
      const path = new URL(route.request().url()).pathname;
      let data = JSON.parse(rewrite(await res.text()));
      if (path === "/api/org") {
        data.teams = data.teams.filter((t) => !HIDDEN_TEAMS.includes(t.id)).map((t) => ({ ...t, ...(TEAMS[t.id] ?? {}) }));
      }
      if (/^\/api\/projects\/[^/]+\/messages$/.test(path) && Array.isArray(data.messages)) {
        data.messages = data.messages.filter((m) => !DROP_MESSAGES.some((re) => re.test((m.text ?? "").trim())));
      }
      await route.fulfill({ response: res, body: JSON.stringify(data) });
    },
  );
}
