/*
 * True-positive fixtures for the Presidio ports. Values are synthetic: test card numbers, the IBAN registry's
 * example accounts, a fictional-range UK phone number (Ofcom 020 7946 0xxx), the 555-01xx US range, documentation
 * IP ranges (RFC 5737, RFC 3849) and an SSN in a valid but made-up range.
 */
import type { Label } from "../../types";

export interface PiiFixture {
  recognizer: string;
  label: Label;
  text: string;
  value: string;
}

export const PII_FIXTURES: PiiFixture[] = [
  { recognizer: "email", label: "pii.email", text: "Send the contract to maria.lopez@acme-corp.io by Friday.", value: "maria.lopez@acme-corp.io" },
  { recognizer: "email", label: "pii.email", text: "Email: dev+alerts@mail.bigco.co.uk", value: "dev+alerts@mail.bigco.co.uk" },
  { recognizer: "phone", label: "pii.phone", text: "Reach me at +44 20 7946 0958.", value: "+44 20 7946 0958" },
  { recognizer: "phone", label: "pii.phone", text: "Office: (415) 555-0132", value: "(415) 555-0132" },
  { recognizer: "phone", label: "pii.phone", text: "Call me on 415-555-0199 tomorrow", value: "415-555-0199" },
  { recognizer: "credit_card", label: "pii.credit_card", text: "Card on file: 4111 1111 1111 1111", value: "4111 1111 1111 1111" },
  { recognizer: "credit_card", label: "pii.credit_card", text: "mastercard 5555555555554444 exp 04/29", value: "5555555555554444" },
  { recognizer: "us_ssn", label: "pii.ssn", text: "SSN 536-22-8175 on the W-4", value: "536-22-8175" },
  { recognizer: "iban", label: "pii.iban", text: "IBAN DE89 3704 0044 0532 0130 00", value: "DE89 3704 0044 0532 0130 00" },
  { recognizer: "iban", label: "pii.iban", text: "wire to GB82WEST12345698765432 today", value: "GB82WEST12345698765432" },
  // Presidio's own example: the trailing " 2" is not part of the IBAN.
  { recognizer: "iban", label: "pii.iban", text: "I want my deposit in DE89370400440532013000 2 days from today.", value: "DE89370400440532013000" },
  { recognizer: "ip", label: "pii.ip", text: "The request came from 203.0.113.42 at noon", value: "203.0.113.42" },
  { recognizer: "ip", label: "pii.ip", text: "client 2001:db8:85a3::8a2e:370:7334 connected", value: "2001:db8:85a3::8a2e:370:7334" },
];
