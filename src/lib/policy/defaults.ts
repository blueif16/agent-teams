/*
 * Our baseline rules (DECISIONS Q10–Q11: no existing Jev rules, so we design our own from E §4.3 R1–R4 and R6).
 * Owner-specific examples (R5 Acme, R7 grants, R8 budgets, the Bluebird classifier) are not defaults.
 * Tool tier defaults (tiers.ts) apply on top: execute stays denied, email and posts ask, reads are free.
 */
import { TIERS } from "./tiers";
import type { Rule } from "./types";

/** An http(s)/any-scheme URL whose host is a dotted IPv4 or a bracketed IPv6 address, userinfo allowed. The engine
 * also tests the parser-normalized URL, so hex, decimal and short IPv4 forms (0x0a000001, 10.1) are caught. */
export const RAW_IP_URL = "(?i)^[a-z][a-z0-9+.-]*://([^/?#@]*@)?(\\d{1,3}(\\.\\d{1,3}){3}|\\[[0-9a-f:.]*\\])([:/?#]|$)";

/** Paste sites, request catchers and tunnels: the usual exfiltration endpoints. */
export const PASTE_AND_TUNNEL_HOSTS = [
  "pastebin.com",
  "paste.ee",
  "hastebin.com",
  "dpaste.org",
  "rentry.co",
  "ghostbin.com",
  "webhook.site",
  "requestbin.com",
  "requestbin.net",
  "pipedream.net",
  "beeceptor.com",
  "ngrok.io",
  "ngrok.app",
  "ngrok-free.app",
  "trycloudflare.com",
  "loca.lt",
  "localtunnel.me",
  "serveo.net",
  "localhost.run",
  "transfer.sh",
  "file.io",
  "0x0.st",
  "interact.sh",
  "oast.fun",
  "burpcollaborator.net",
];

const T6_TOOLS = TIERS.find((t) => t.tier === "T6")!.tools;

export const DEFAULT_RULES: Rule[] = [
  // R1: secrets never leave the machine in clear text (Q10: tokenized before Crusoe).
  { id: "r_secr01", kind: "flow", scope: {}, labels: ["secret.*"], sinks: ["model:*"], action: "tokenize", locked: true, createdBy: "default", reason: "Secrets reach the model only as placeholders" },
  {
    id: "r_secr02",
    kind: "flow",
    scope: {},
    labels: ["secret.*"],
    sinks: ["trace:*", "memory:self", "memory:global"],
    action: "redact",
    locked: true,
    createdBy: "default",
    reason: "Secrets are removed from traces and memory",
  },
  {
    id: "r_secr03",
    kind: "flow",
    scope: {},
    labels: ["secret.*"],
    sinks: ["web", "email", "calendar", "api:*", "project:other"],
    action: "block",
    locked: true,
    createdBy: "default",
    reason: "Secrets never leave the machine",
  },

  // R2: no raw-IP URLs and no paste, request-catcher or tunnel hosts, for any tool.
  { id: "r_rawip1", kind: "tool", scope: {}, match: { tools: ["*"] }, effect: "deny", args: [{ path: "url", op: "matches", value: RAW_IP_URL }], createdBy: "default", reason: "No raw-IP URLs" },
  { id: "r_rawip2", kind: "tool", scope: {}, match: { tools: ["*"] }, effect: "deny", args: [{ path: "urls[*]", op: "matches", value: RAW_IP_URL }], createdBy: "default", reason: "No raw-IP URLs" },
  {
    id: "r_paste1",
    kind: "tool",
    scope: {},
    match: { tools: ["*"] },
    effect: "deny",
    args: [{ path: "url", op: "domain_in", value: PASTE_AND_TUNNEL_HOSTS }],
    createdBy: "default",
    reason: "No paste sites or tunnels",
  },
  {
    id: "r_paste2",
    kind: "tool",
    scope: {},
    match: { tools: ["*"] },
    effect: "deny",
    args: [{ path: "urls[*]", op: "domain_in", value: PASTE_AND_TUNNEL_HOSTS }],
    createdBy: "default",
    reason: "No paste sites or tunnels",
  },

  // R3: the lethal trifecta. Egress to a destination that first appeared in untrusted content asks, every time.
  {
    id: "r_taint1",
    kind: "tool",
    scope: {},
    match: { tools: ["fetch_page", "web_fetch", "send_email", "post_message", "create_calendar_event", "http_*", "api_*"] },
    effect: "ask",
    when: { contextLabels: { any: ["untrusted"] }, destFromUntrusted: true },
    locked: true,
    createdBy: "default",
    reason: "Destination came from a web page or email",
  },

  // R4: project boundary. Project data never crosses into another project; cross-project memory asks (Q8).
  { id: "r_proj01", kind: "flow", scope: {}, labels: ["project:*"], sinks: ["project:other"], action: "block", createdBy: "default", reason: "Project data stays in its project" },
  {
    id: "r_proj02",
    kind: "flow",
    scope: {},
    labels: ["project:*"],
    sinks: ["memory:global"],
    action: "ask",
    createdBy: "default",
    reason: "This would carry project details into the agent's memory for other projects",
  },

  // R6: email asks unless a recipient grant exists; money and credentials ask every time and are never grantable.
  {
    id: "r_mail01",
    kind: "tool",
    scope: {},
    match: { tools: ["send_email"] },
    effect: "ask",
    approval: { allowedDecisions: ["approve", "edit", "reject"], offerGrants: ["once", "project", "30d"], phrase: "send this email" },
    createdBy: "default",
  },
  {
    id: "r_buy001",
    kind: "tool",
    scope: {},
    match: { tools: [...T6_TOOLS] },
    effect: "ask",
    locked: true,
    approval: { allowedDecisions: ["approve", "reject"], offerGrants: ["once"] },
    createdBy: "default",
    reason: "Money and credentials ask every time",
  },
];

export const DEFAULT_RULE_IDS = new Set(DEFAULT_RULES.map((r) => r.id));
