/*
 * Hard negatives: text an agent writes all the time that must produce NO span. Sources: gitleaks false-positive
 * samples (cmd/generate/config/rules/*.go @ b58d3f1, MIT), the hard negatives E-privacy.md §3 names (UUIDs, git
 * SHAs, base64 image data, masked values, placeholders), and everyday agent output.
 */
export interface BenignFixture {
  name: string;
  text: string;
}

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export const BENIGN_SECRET_LIKE: BenignFixture[] = [
  { name: "a UUID in a log line", text: "Request 3f2b8c1e-9d4a-4b7e-8f1a-2c6d9e0b5a71 completed in 42 ms" },
  { name: "a UUID under an api_*_id key", text: '{"api_request_id": "3f2b8c1e-9d4a-4b7e-8f1a-2c6d9e0b5a71", "status": 200}' },
  { name: "a full git SHA", text: "Merged in commit 2638fa4e1b9c0d7a5f3e8b6c4d2a1f0e9b8c7d6a on main." },
  { name: "short SHAs in a git log", text: "2638fa4 chore: stub the detector pack interface\nb21a7cf docs: accept the team-setup defaults" },
  { name: "base64 PNG data URI", text: `<img src="data:image/png;base64,${PNG_1PX}" alt="pixel">` },
  { name: "base64 image under an image key", text: `{"thumbnail": "${PNG_1PX}"}` },
  {
    name: "lorem ipsum",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  },
  { name: "dependency versions", text: "Upgraded next to 16.4.2 and react to 19.3.0; vitest stays on ^5.0.5." },
  { name: "runtime versions", text: "Node v24.1.0, npm 11.4.1, Python 3.12.12 (main, Oct  9 2025, 11:07:00)" },
  { name: "docs text about keys on example.com", text: "See https://example.com/docs/api-keys to create an API key, then set it as API_KEY in .env." },
  { name: "the AWS docs example key (gitleaks fp)", text: "aws_access_key: AKIAIOSFODNN7EXAMPLE" },
  { name: "a low-entropy AWS-shaped key (gitleaks fp)", text: "key = AKIAXXXXXXXXXXXXXXXX" },
  { name: "a GitHub token placeholder (gitleaks fp)", text: "GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  { name: "an env template placeholder", text: "OPENAI_API_KEY=<your-api-key>" },
  { name: "a templated password", text: "password: ${DB_PASSWORD}" },
  { name: "a low-entropy value under a key", text: 'api_key = "11111111112222222222"' },
  { name: "a word-only value under a key (gitleaks generic allowlist)", text: 'secret_name = "production_database_password"' },
  { name: "a key-length setting (gitleaks generic allowlist)", text: "key_length = 4096" },
  { name: "prose about tokens", text: "The tokenizer splits text into tokens before the model sees them; each token costs a little." },
  { name: "a private key header with no body (gitleaks fp)", text: "-----BEGIN PRIVATE KEY-----\nanything\n-----END PRIVATE KEY-----" },
  { name: "a database URL with a template password (secretlint ok)", text: 'const MYSQL_TEMPLATE = "mysql://user:${PASSWORD}@example.com:3306/db";' },
  { name: "a database URL with identical user and password (secretlint ok)", text: 'const PG = "postgres://postgres:postgres@localhost:5432/database";' },
  { name: "a basic-auth URL with placeholder credentials (secretlint ok)", text: "Use https://myusername:mypassword@host.example.net/path in the docs." },
  { name: "a SHA-256 checksum", text: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" },
  { name: "an ISO timestamp", text: "Deployed at 2026-10-17T19:47:43Z by the release job." },
  { name: "CSS colours", text: ".card { color: #1a2b3c; background: #ffffff; border: 1px solid #e5e7eb; }" },
];

/** PII-shaped text that fails a validator, is a reserved or placeholder value, or is masked. */
export const BENIGN_PII_LIKE: BenignFixture[] = [
  { name: "a card number failing Luhn", text: "Card 4111 1111 1111 1112 was declined" },
  { name: "a dashed card-like number failing Luhn", text: "Order 5555-5555-5555-4445 shipped" },
  { name: "an SSN-like number with area 000", text: "ref 000-12-3456" },
  { name: "an SSN-like number with area 666", text: "ref 666-45-6789" },
  { name: "an SSN-like number with area 9xx", text: "ref 912-34-5678" },
  { name: "an SSN-like number with group 00", text: "ref 123-00-4567" },
  { name: "an SSN-like number with serial 0000", text: "ref 123-45-0000" },
  { name: "the Woolworth wallet SSN", text: "the famous 078-05-1120 card" },
  { name: "an SSN-like number with one repeated digit", text: "ref 111-11-1111" },
  { name: "an SSN-like number with mixed delimiters", text: "ref 536-22 8175" },
  { name: "an IBAN-like string failing mod-97", text: "IBAN DE89 3704 0044 0532 0130 01" },
  { name: "a GB IBAN-like string failing mod-97", text: "GB82 WEST 1234 5698 7654 31" },
  { name: "example.com addresses in docs", text: "Email support@example.com for help, or write to jane.doe@example.org." },
  { name: "a masked email", text: "Signed in as j***@e***.com" },
  { name: "a masked card", text: "Paid with **** **** **** 4242" },
  { name: "a retina asset name", text: "Use logo@2x.png on high-DPI screens" },
  { name: "a scoped npm spec", text: "npm i -D @types/node@24.19.2" },
  { name: "a loopback address", text: "Server listening on http://127.0.0.1:3000" },
  { name: "the unspecified address", text: "Bind to 0.0.0.0 inside the container" },
  { name: "a millisecond timestamp", text: "created_at 1729180800000" },
];

/** False positives the pack produced on this repo's own docs and code (measured), kept as regressions. */
export const BENIGN_MEASURED: BenignFixture[] = [
  { name: "an email with a masked local part", text: "Masked in the UI as j***@acme.com" },
  { name: "a markdown file path with an @ in its name", text: "see Meta/muse-agent/workspace/cron.d/minutely/heartbeat__interval@30m.md" },
  { name: "the IPv6 unspecified address written ::0", text: "listen on ::0 port 8080" },
  { name: "a commit SHA under a name containing 'secret'", text: 'export const SECRETLINT_COMMIT = "92f0b0c4ada432bfa8e5c3a22fbc2b8dff5946dd";' },
];
