/*
 * True-positive fixtures for the secret rules. `secret` is the exact substring a rule must report as its span.
 *
 * gitleaks samples are each rule's own true-positive examples from cmd/generate/config/rules/*.go @ b58d3f1 (MIT,
 * Copyright (c) 2019 Zachary Rice), wrapped the way its GenerateSampleSecrets helper wraps them where the sample is a
 * bare token. They are published, non-working example values. github-pat has no fixed sample upstream (it generates
 * a random one), so its value here is made up. secretlint samples follow its test snapshots @ 92f0b0c (MIT).
 */
import type { Label } from "../../types";

export interface SecretFixture {
  rule: string;
  detector: "gitleaks" | "secretlint";
  label: Label;
  text: string;
  secret: string;
}

const PEM_BODY =
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDAC4AWkdwKYSd8\n" + "Ks14IReLcYgADhoXk56ZzXI=";

/** Fake PKCS#8 body, long enough for secretlint's 100-char floor; not a real key. */
const LONG_PEM_BODY =
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDAC4AWkdwKYSd8\n" +
  "Ks14IReLcYgADhoXk56ZzXIq7N2fV9tLmR4sWkXbPzQy8HcJdUoG1eAvTnMiE3Lr\n" +
  "Zx5KpYw0aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcdefghijklmnopqrstu==";

const g = (rule: string, label: Label, text: string, secret: string): SecretFixture => ({ rule, detector: "gitleaks", label, text, secret });

export const SECRET_FIXTURES: SecretFixture[] = [
  g("1password-secret-key", "secret.1password", "op secret key A3-ASWWYB-798JRYLJVD4-23DC2-86TVM-H43EB for the vault", "A3-ASWWYB-798JRYLJVD4-23DC2-86TVM-H43EB"),
  g(
    "anthropic-api-key",
    "secret.anthropic",
    'ANTHROPIC_API_KEY="sk-ant-api03-abc123xyz-456def789ghij-klmnopqrstuvwx-3456yza789bcde-1234fghijklmnopby56aaaogaopaaaabc123xyzAA"',
    "sk-ant-api03-abc123xyz-456def789ghij-klmnopqrstuvwx-3456yza789bcde-1234fghijklmnopby56aaaogaopaaaabc123xyzAA",
  ),
  g(
    "anthropic-admin-api-key",
    "secret.anthropic",
    "admin key: sk-ant-admin01-abc12fake-456def789ghij-klmnopqrstuvwx-3456yza789bcde-12fakehijklmnopby56aaaogaopaaaabc123xyzAA",
    "sk-ant-admin01-abc12fake-456def789ghij-klmnopqrstuvwx-3456yza789bcde-12fakehijklmnopby56aaaogaopaaaabc123xyzAA",
  ),
  g("aws-access-token", "secret.aws", 'aws_token = "AKIALALEMEL33243OLIB"', "AKIALALEMEL33243OLIB"),
  g("azure-ad-client-secret", "secret.azure", "client_secret=bP88Q~rcBcYjzzOhg1Hnn76Wm3jGgakZiZ.8vMgR", "bP88Q~rcBcYjzzOhg1Hnn76Wm3jGgakZiZ.8vMgR"),
  g("clickhouse-cloud-api-secret-key", "secret.clickhouse", 'ClickHouseToken = "4b1dbRdW3rOcB7xLthrM4BTBGK1qPLkHigpN1bXD6z"', "4b1dbRdW3rOcB7xLthrM4BTBGK1qPLkHigpN1bXD6z"),
  g(
    "curl-auth-header",
    "secret.credential",
    '# curl -X GET "http://localhost:3000/api/cron/status" -H "Authorization: Bearer cfcabd11c7ed9a41b1a3e063c32d5114"',
    "cfcabd11c7ed9a41b1a3e063c32d5114",
  ),
  g("curl-auth-user", "secret.credential", "curl --cacert ca.crt -u elastic:P@ssw0rd$1 https://localhost:9200", "elastic:P@ssw0rd$1"),
  g("facebook-secret", "secret.facebook", 'facebook_app_secret = "6dca6432e45d933e13650d1882bd5e69"', "6dca6432e45d933e13650d1882bd5e69"),
  g("gcp-api-key", "secret.gcp", 'firebase apiKey: "AIzaSyNHxIf32IQ1a1yjl3ZJIqKZqzLAK1XhDk-"', "AIzaSyNHxIf32IQ1a1yjl3ZJIqKZqzLAK1XhDk-"),
  g("generic-api-key", "secret.generic", 'generic_token = "Zf3D0LXCM3EIMbgJpUNnkRtOfOueHznB"', "Zf3D0LXCM3EIMbgJpUNnkRtOfOueHznB"),
  g("github-pat", "secret.github", "export GH=ghp_R7mQ2xL9vT4kN8pW3sY6dF1hJ5bC0gZaE2uI", "ghp_R7mQ2xL9vT4kN8pW3sY6dF1hJ5bC0gZaE2uI"),
  g(
    "grafana-service-account-token",
    "secret.grafana",
    "'Authorization': 'Bearer glsa_pITqMOBIfNH2KL4PkXJqmTyQl0D9QGxF_486f63e1'",
    "glsa_pITqMOBIfNH2KL4PkXJqmTyQl0D9QGxF_486f63e1",
  ),
  g(
    "hashicorp-tf-api-token",
    "secret.hashicorp",
    '#token = "hE1hlYILrSqpqh.atlasv1.ARjZuyzl33F71WR55s6ln5GQ1HWIwTDDH3MiRjz7OnpCfaCb1RCF5zGaSncCWmJdcYA"',
    "hE1hlYILrSqpqh.atlasv1.ARjZuyzl33F71WR55s6ln5GQ1HWIwTDDH3MiRjz7OnpCfaCb1RCF5zGaSncCWmJdcYA",
  ),
  g("vault-service-token", "secret.vault", "token: s.ZC9Ecf4M5g9o34Q6RkzGsj0z", "s.ZC9Ecf4M5g9o34Q6RkzGsj0z"),
  g(
    "heroku-api-key-v2",
    "secret.heroku",
    'API_Key = "HRKU-AAy9Ppr_HD2pPuTyIiTYInO0hbzhoERRSO93ZQusSYHgaD7_WQ07FnF7L9FX"',
    "HRKU-AAy9Ppr_HD2pPuTyIiTYInO0hbzhoERRSO93ZQusSYHgaD7_WQ07FnF7L9FX",
  ),
  g("huggingface-access-token", "secret.huggingface", "huggingface-cli login --token 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", "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"),
  g("huggingface-organization-api-token", "secret.huggingface", "HF_ORG=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", "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"),
  g(
    "intra42-client-secret",
    "secret.intra42",
    'secret: "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"',
    "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",
  ),
  g(
    "jwt",
    "secret.jwt",
    '"access_token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3NLZXkiOiJRMzFDVlMxUFNDSjRPVEsyWVZFTSIsImF0X2hhc2giOiI4amItZFE2OXRtZEVueUZaMUttNWhnIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImV4cCI6IjE1OTQ2MDAxODIiLCJpYXQiOjE1OTQ1ODkzODQsImlzcyI6Imh0dHA6Ly8xMjcuMC4wLjE6NTU1Ni9kZXgiLCJuYW1lIjoiYWRtaW4iLCJzdWIiOiJDaVF3T0dFNE5qZzBZaTFrWWpnNExUUmlOek10T1RCaE9TMHpZMlF4TmpZeFpqVTBOallTQld4dlkyRnMifQ.nrbzIJz99Om7TvJ04jnSTmhvlM7aR9hMM1Aqjp2ONJ1UKYCvegBLrTu6cYR968_OpmnAGJ8vkd7sIjUjtR4zbw"',
    "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3NLZXkiOiJRMzFDVlMxUFNDSjRPVEsyWVZFTSIsImF0X2hhc2giOiI4amItZFE2OXRtZEVueUZaMUttNWhnIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImV4cCI6IjE1OTQ2MDAxODIiLCJpYXQiOjE1OTQ1ODkzODQsImlzcyI6Imh0dHA6Ly8xMjcuMC4wLjE6NTU1Ni9kZXgiLCJuYW1lIjoiYWRtaW4iLCJzdWIiOiJDaVF3T0dFNE5qZzBZaTFrWWpnNExUUmlOek10T1RCaE9TMHpZMlF4TmpZeFpqVTBOallTQld4dlkyRnMifQ.nrbzIJz99Om7TvJ04jnSTmhvlM7aR9hMM1Aqjp2ONJ1UKYCvegBLrTu6cYR968_OpmnAGJ8vkd7sIjUjtR4zbw",
  ),
  g("mailchimp-api-key", "secret.mailchimp", "mailchimp_api_key: cefa780880ba5f5696192a34f6292c35-us18", "cefa780880ba5f5696192a34f6292c35-us18"),
  g("notion-api-token", "secret.notion", "NOTION_TOKEN=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", "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"),
  g("octopus-deploy-api-key", "secret.octopus_deploy", 'set apikey="API-ZNRMR7SL6L3ATMOIK7GKJDKLPY"', "API-ZNRMR7SL6L3ATMOIK7GKJDKLPY"),
  g("okta-access-token", "secret.okta", '"oktaApiToken": "00ebObu4zSNkyc6dimLvUwq4KpTEop-PCEnnfSTpD3",', "00ebObu4zSNkyc6dimLvUwq4KpTEop-PCEnnfSTpD3"),
  g(
    "openai-api-key",
    "secret.openai",
    "OPENAI_API_KEY=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",
    "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",
  ),
  // At the very end of the text: exercises the \z → $ port.
  g("openshift-user-token", "secret.openshift", "Authorization: Bearer sha256~kV46hPnEYhCWFnB85r5NrprAxggzgb6GOeLbgcKNsH0", "sha256~kV46hPnEYhCWFnB85r5NrprAxggzgb6GOeLbgcKNsH0"),
  g("perplexity-api-key", "secret.perplexity", "PERPLEXITY_API_KEY=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", "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"),
  g("scalingo-api-token", "secret.scalingo", 'scalingo_api_token = "tk-us-loys7ib9yrxcys_ta2sq85mjar6lgcsspkd9x61s7h5epf_-"', "tk-us-loys7ib9yrxcys_ta2sq85mjar6lgcsspkd9x61s7h5epf_-"),
  g(
    "sentry-org-token",
    "secret.sentry",
    "SENTRY_AUTH_TOKEN is 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",
    "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",
  ),
  g("slack-bot-token", "secret.slack", '"bot_token1": "xoxb-781236542736-2364535789652-GkwFDQoHqzXDVsC6GzqYUypD"', "xoxb-781236542736-2364535789652-GkwFDQoHqzXDVsC6GzqYUypD"),
  g(
    "slack-user-token",
    "secret.slack",
    '"user_token1": "xoxp-41684372915-1320496754-45609968301-e708ba56e1517a99f6b5fb07349476ef"',
    "xoxp-41684372915-1320496754-45609968301-e708ba56e1517a99f6b5fb07349476ef",
  ),
  g(
    "slack-app-token",
    "secret.slack",
    '"token1": "xapp-1-A052FGTS2DL-5171572773297-610b6a11f4b7eb819e87b767d80e6575a3634791acb9a9ead051da879eb5b55e"',
    "xapp-1-A052FGTS2DL-5171572773297-610b6a11f4b7eb819e87b767d80e6575a3634791acb9a9ead051da879eb5b55e",
  ),
  g(
    "slack-webhook-url",
    "secret.slack",
    "post to https://hooks.slack.com/services/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 when done",
    "https://hooks.slack.com/services/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",
  ),
  // Upper-case hex: matches only with the i flag the (?i) port sets.
  g("snyk-api-token", "secret.snyk", 'const SNYK_TOKEN = "12345678-ABCD-ABCD-ABCD-1234567890AB"', "12345678-ABCD-ABCD-ABCD-1234567890AB"),
  // secretGroup = 2: group 1 is the word "LOGIN".
  g("sonar-api-token", "secret.sonar", 'const SONAR_LOGIN = "12345678ABCDEFH1234567890ABCDEFH12345678"', "12345678ABCDEFH1234567890ABCDEFH12345678"),
  g("sourcegraph-access-token", "secret.sourcegraph", "src token sgp_AaD80dc6E02eCAE1_d3cba16CC0F18fA14A2EFB61CbDFceEBf9fAD16b", "sgp_AaD80dc6E02eCAE1_d3cba16CC0F18fA14A2EFB61CbDFceEBf9fAD16b"),
  g("square-access-token", "secret.square", "ARG token=sq0atp-812erere3wewew45678901", "sq0atp-812erere3wewew45678901"),
  g(
    "stripe-access-token",
    "secret.stripe",
    "stripe.api_key = 'sk_test_51OuEMLAlTWGaDypq4P5cuDHbuKeG4tAGPYHJpEXQ7zE8mKK3jkhTFPvCxnSSK5zB5EQZrJsYdsatNmAHGgb0vSKD00GTMSWRHs'",
    "sk_test_51OuEMLAlTWGaDypq4P5cuDHbuKeG4tAGPYHJpEXQ7zE8mKK3jkhTFPvCxnSSK5zB5EQZrJsYdsatNmAHGgb0vSKD00GTMSWRHs",
  ),
  g(
    "sumologic-access-token",
    "secret.sumologic",
    "SUMO_ACCESS_KEY: gxq3rJQkS6qovOg9UY2Q70iH1jFZx0WBrrsiAYv4XHodogAwTKyLzvFK4neRN8Dk",
    "gxq3rJQkS6qovOg9UY2Q70iH1jFZx0WBrrsiAYv4XHodogAwTKyLzvFK4neRN8Dk",
  ),
  g("sidekiq-sensitive-url", "secret.sidekiq", "source https://cafebabe:deadbeef@gems.contribsys.com/", "cafebabe:deadbeef"),
  g("private-key", "secret.private_key", `key.pem:\n-----BEGIN PRIVATE KEY-----\n${PEM_BODY}\n-----END PRIVATE KEY-----\n`, `-----BEGIN PRIVATE KEY-----\n${PEM_BODY}\n-----END PRIVATE KEY-----`),
  {
    rule: "database-connection-string",
    detector: "secretlint",
    label: "secret.credential",
    text: 'const POSTGRES_URI = "postgres://api_user:myC0mpl3xPwd@db.internal.com:5432/api_db";',
    secret: "api_user:myC0mpl3xPwd",
  },
  {
    rule: "basicauth",
    detector: "secretlint",
    label: "secret.credential",
    text: 'const PROD_API = "https://apiuser:r3alP4ssw0rd@api.production.com/v2";',
    secret: "apiuser:r3alP4ssw0rd",
  },
  {
    rule: "privatekey",
    detector: "secretlint",
    label: "secret.private_key",
    text: `-----BEGIN RSA PRIVATE KEY-----\n${LONG_PEM_BODY}\n-----END RSA PRIVATE KEY-----`,
    secret: `-----BEGIN RSA PRIVATE KEY-----\n${LONG_PEM_BODY}\n-----END RSA PRIVATE KEY-----`,
  },
];
