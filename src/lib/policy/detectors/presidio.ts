/*
 * TypeScript ports of six Microsoft Presidio recognizers (E §3): email, phone, credit card, US SSN, IBAN, IP.
 *
 * Source: https://github.com/microsoft/presidio @ 2523c7b74a469270c5c78bb253f140eafca21e31,
 * presidio-analyzer/presidio_analyzer/predefined_recognizers/generic/{email,phone,credit_card,iban,ip}_recognizer.py,
 * iban_patterns.py and country_specific/us/us_ssn_recognizer.py; context scoring from
 * context_aware_enhancers/lemma_context_aware_enhancer.py. MIT License, Copyright (c) Presidio Contributors.
 * The full notice is in LICENSES/presidio.txt.
 *
 * Kept: patterns, base scores, context words, validators (Luhn, IBAN mod-97 + country format, SSN invalid ranges, IP
 * parse, email domain) and Presidio's context boost (+0.35, floor 0.4, five words before). The pack reports a span
 * from score 0.5 (Presidio returns scores; our Span has none, so the threshold is applied here).
 * Changed: Presidio finds phones with the python-phonenumbers library, so the phone patterns here are our own
 * formatted-number regexes with Presidio's score (0.4) and context words, plus 0.5 for unambiguous formats (+country
 * code, (area) code); the SSN keeps only its medium pattern (the 0.05 "very weak" ones can't reach 0.5 even with
 * context) and also rejects areas 900-999 (never issued); IPv6_unspecified (0.1) is dropped; the email local part is
 * capped at 64 chars (RFC 5321) so V8's backtracking stays linear; email domains are checked for a plausible TLD, not
 * against the public-suffix list tldextract uses.
 */
import type { AllowSpec, RuleSpec } from "./engine";

export const PRESIDIO_COMMIT = "2523c7b74a469270c5c78bb253f140eafca21e31";

/** Presidio's default global_regex_flags: DOTALL | MULTILINE | IGNORECASE. */
const FLAGS = "ims";
const D = "presidio-ports";

const EMAIL_CHAR = "[!#$%&'*+\\-/=?^_\\x60{|}~\\w]";
const OCTET = "(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)";
const IPV6 =
  "(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|:(?::[0-9A-Fa-f]{1,4}){1,7}|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}|:(?::[0-9A-Fa-f]{1,4}){1,6})";

const PHONE_CONTEXT = ["phone", "number", "telephone", "cell", "cellphone", "mobile", "call"];
const IP_CONTEXT = ["ip", "ipv4", "ipv6"];

export const PRESIDIO_RULES: RuleSpec[] = [
  {
    id: "email",
    label: "pii.email",
    detector: D,
    source: `\\b((${EMAIL_CHAR})|(${EMAIL_CHAR}[!#$%&'*+\\-/=?^_\\x60{|}~\\.\\w]{0,62}${EMAIL_CHAR}))[@]\\w+(?:-+\\w+)*(?:\\.\\w+(?:-+\\w+)*)+\\b`,
    flags: FLAGS,
    keywords: ["@"],
    secretGroup: 0,
    score: 0.5,
    context: ["email"],
    validator: "email",
  },
  {
    id: "phone-international",
    label: "pii.phone",
    detector: D,
    source: "(?<![\\w+])\\+[1-9]\\d{0,2}[ .-]?(?:\\(\\d{1,4}\\)[ .-]?)?\\d{1,4}(?:[ .-]?\\d{2,4}){1,4}(?!\\w)",
    flags: FLAGS,
    keywords: ["+"],
    secretGroup: 0,
    score: 0.5,
    context: PHONE_CONTEXT,
    validator: "phone",
  },
  {
    id: "phone-us-area-code",
    label: "pii.phone",
    detector: D,
    source: "(?<![\\w(])\\(\\s?[2-9]\\d{2}\\s?\\)\\s?[2-9]\\d{2}[ .-]\\d{4}(?!\\w)",
    flags: FLAGS,
    keywords: ["("],
    secretGroup: 0,
    score: 0.5,
    context: PHONE_CONTEXT,
    validator: "phone",
  },
  {
    id: "phone-us",
    label: "pii.phone",
    detector: D,
    source: "(?<![\\w+.-])(?:1[ .-])?[2-9]\\d{2}[ .-][2-9]\\d{2}[ .-]\\d{4}(?!\\w|[.-]\\d)",
    flags: FLAGS,
    secretGroup: 0,
    score: 0.4,
    context: PHONE_CONTEXT,
    validator: "phone",
  },
  {
    id: "credit_card",
    label: "pii.credit_card",
    detector: D,
    source: "\\b(?!1\\d{12}(?!\\d))((4\\d{3})|(5[0-5]\\d{2})|(6\\d{3})|(1\\d{3})|(3\\d{3}))[- ]?(\\d{3,4})[- ]?(\\d{3,4})[- ]?(\\d{3,5})\\b",
    flags: FLAGS,
    secretGroup: 0,
    score: 0.3,
    context: ["credit", "card", "visa", "mastercard", "cc ", "amex", "discover", "jcb", "diners", "maestro", "instapayment"],
    validator: "luhn",
  },
  {
    id: "us_ssn",
    label: "pii.ssn",
    detector: D,
    source: "\\b([0-9]{3})[- .]([0-9]{2})[- .]([0-9]{4})\\b",
    flags: FLAGS,
    secretGroup: 0,
    score: 0.5,
    context: ["social", "security", "ssn", "ssns", "ssid"],
    validator: "us_ssn",
  },
  {
    id: "iban",
    label: "pii.iban",
    detector: D,
    // IBAN uses DOTALL | MULTILINE only (no IGNORECASE).
    source: "(?<![A-Z0-9])([A-Z]{2}[0-9]{2}(?:[ -]?[A-Z0-9]{4}){2,6})((?:[ -]?[A-Z0-9]{4})?)((?:[ -]?[A-Z0-9]{1,3})?)(?![A-Z0-9])",
    flags: "ms",
    score: 0.5,
    context: ["iban", "bank", "transaction"],
    validator: "iban",
  },
  {
    id: "ip-v4-mapped",
    label: "pii.ip",
    detector: D,
    source: `(?<![\\w:])::(?:ffff(?::0{1,4})?:)?(?:${OCTET}\\.){3}${OCTET}(?:/(?:12[0-8]|1[01]\\d|[1-9]?\\d))?\\b`,
    flags: FLAGS,
    keywords: ["::"],
    secretGroup: 0,
    score: 0.6,
    context: IP_CONTEXT,
    validator: "ip",
  },
  {
    id: "ip-v4-embedded",
    label: "pii.ip",
    detector: D,
    source: `(?<![\\w:])(?:(?:[0-9A-Fa-f]{1,4}:){1,5}:(?:[0-9A-Fa-f]{1,4}:){0,4}|(?:[0-9A-Fa-f]{1,4}:){6})(?:${OCTET}\\.){3}${OCTET}(?:/(?:12[0-8]|1[01]\\d|[1-9]?\\d))?\\b`,
    flags: FLAGS,
    keywords: [":"],
    secretGroup: 0,
    score: 0.6,
    context: IP_CONTEXT,
    validator: "ip",
  },
  {
    id: "ip-v4",
    label: "pii.ip",
    detector: D,
    source: `\\b${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}(?:/(?:[0-2]?\\d|3[0-2]))?\\b`,
    flags: FLAGS,
    keywords: ["."],
    secretGroup: 0,
    score: 0.6,
    context: IP_CONTEXT,
    validator: "ip",
  },
  {
    id: "ip-v6",
    label: "pii.ip",
    detector: D,
    source: `(?<![\\w:])${IPV6}(?:%[0-9a-zA-Z]+)?(?:/(?:12[0-8]|1[01]\\d|[1-9]?\\d))?(?![\\w:]|\\.\\d)`,
    flags: FLAGS,
    keywords: [":"],
    secretGroup: 0,
    score: 0.6,
    context: IP_CONTEXT,
    validator: "ip",
  },
];

/** Recognizers ported (the rule count shown in listDetectors). */
export const PRESIDIO_RECOGNIZERS = ["email", "phone", "credit_card", "us_ssn", "iban", "ip"] as const;

/**
 * The pack's own PII allowlist: reserved documentation domains (RFC 2606/6761), already-masked values (`j***@…`,
 * the false positives in a Jev PoC, E §3), and the loopback and unspecified addresses, which name no one.
 */
export const PRESIDIO_ALLOW: AllowSpec[] = [
  { regexes: [{ source: "@(?:[\\w-]+\\.)*example\\.(?:com|net|org)$|\\.(?:example|test|invalid|localhost)$", flags: "i" }] },
  { regexes: [{ source: "^[^@]*\\*{2,}[^@]*@", flags: "" }] },
  { regexes: [{ source: "^(?:127(?:\\.\\d{1,3}){3}|0\\.0\\.0\\.0|::(?:0{0,4}|0{0,3}1))(?:/\\d{1,3})?$", flags: "" }] },
];
