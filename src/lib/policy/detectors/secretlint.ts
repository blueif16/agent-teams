/*
 * Three secretlint rules, ported (E §3): database-connection-string, basicauth, privatekey.
 *
 * Source: https://github.com/secretlint/secretlint @ 92f0b0c4ada432bfa8e5c3a22fbc2b8dff5946dd,
 * packages/@secretlint/secretlint-rule-{database-connection-string,basicauth,privatekey}/src/index.ts.
 * MIT License, Copyright (c) 2020 azu. The full notice is in LICENSES/secretlint.txt.
 * Changes: the three connection-string patterns share one rule (their tails are identical); the credential part is
 * wrapped in a named group `cred` so the span covers `user:password` rather than the whole URL; the placeholder and
 * template checks live in engine.ts (validators `db_credential`, `basic_auth`, `pem_base64`).
 */
import type { RuleSpec } from "./engine";

export const SECRETLINT_COMMIT = "92f0b0c4ada432bfa8e5c3a22fbc2b8dff5946dd";

export const SECRETLINT_RULES: RuleSpec[] = [
  {
    id: "database-connection-string",
    label: "secret.credential",
    detector: "secretlint",
    source: String.raw`(?:mongodb(?:\+srv)?|(?:jdbc:)?mysql(?:x)?|postgres(?:ql)?):\/\/(?:(?<cred>(?<username>[^:\/\s]{1,100}):(?<password>[^@\/\s]{1,200}))@)?(?<host>[^\/\s?]{1,100})(?:\/(?<database>[^?\s]{0,100}))?(?:\?(?<options>[^\s]{0,500}))?`,
    flags: "i",
    keywords: ["mongodb", "mysql", "postgres"],
    secretGroup: "cred",
    validator: "db_credential",
  },
  {
    id: "basicauth",
    label: "secret.credential",
    detector: "secretlint",
    source: String.raw`(?<protocol>(?:https?|ftp|ftps)):\/\/(?<cred>(?<user>[-a-zA-Z0-9_]{1,256}):(?<password>[-a-zA-Z0-9_]{1,256}))@[-a-zA-Z0-9%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b`,
    flags: "",
    keywords: ["://"],
    secretGroup: "cred",
    validator: "basic_auth",
  },
  {
    id: "privatekey",
    label: "secret.private_key",
    detector: "secretlint",
    source: String.raw`-----BEGIN[ ]?(?:(?:RSA|DSA|EC|OPENSSH|PGP) )?PRIVATE KEY(?: BLOCK)?-----\n?(?<body>[A-Za-z0-9+/=\s\\]{100,10000})\n?-----END[ ]?(?:(?:RSA|DSA|EC|OPENSSH|PGP) )?PRIVATE KEY(?: BLOCK)?-----`,
    flags: "m",
    keywords: ["private key"],
    secretGroup: 0,
    validator: "pem_base64",
  },
];
