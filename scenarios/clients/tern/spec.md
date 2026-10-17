# Tern pricing study: what we need

Three files. Every price comes from a vendor's public pricing page.

1. **`plans.csv`**: one row per paid plan, at least 12 rows from at least 8 vendors. Columns:
   `vendor, plan, price_usd, url, accessed, price_quote`
   - `price_usd`: list price per user per month in USD (annual billing if that's the headline price).
   - `url`: the pricing page; `accessed`: the date you read it (YYYY-MM-DD).
   - `price_quote`: the price line copied word for word from the page.
2. **`costs.csv`**: the monthly cost of each plan for each usage profile. Columns:
   `vendor, plan, profile, price_usd, users, monthly_usd`, where `monthly_usd = price_usd × users`.
   Profiles: `solo` (1 user) and `team-5` (5 users).
3. **`memo.md`**: at most 500 words, for Tern's two founders.
   - Sections, in order: `## Recommendation`, `## Market`, `## Evidence`.
   - The first three sentences say what to charge for each tier.
   - A table of the recommended tiers with columns `tier | price_usd | features`. Features are `;`-separated, and
     each tier includes everything in the tier below.
   - Every $ price is either in `plans.csv` or inside a range you cite, like "$15–$24", whose ends are in
     `plans.csv`.
