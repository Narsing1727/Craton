// Turn on "Continue with Google" / "Continue with GitHub": writes the client id and secret into backend/.env and says
// which address to register with the provider.
//
//   npm run setup:oauth -- --google-id <id> --google-secret <secret> [--github-id <id> --github-secret <secret>] [--web-url https://craton.example]
//
// Then restart the API. A secret given on the command line stays in your shell history; for a shared machine, edit
// backend/.env directly instead (copy .env.example).

import fs from "node:fs";
import path from "node:path";
import { readEnv, upsertEnv } from "../src/dev/envfile.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const file = process.env.CRATON_ENV_FILE ?? path.resolve(import.meta.dirname, "../.env");
const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const set: Record<string, string> = {};
const pairs: [string, string, string][] = [
  ["google-id", "CRATON_GOOGLE_CLIENT_ID", "Google client id"],
  ["google-secret", "CRATON_GOOGLE_CLIENT_SECRET", "Google client secret"],
  ["github-id", "CRATON_GITHUB_CLIENT_ID", "GitHub client id"],
  ["github-secret", "CRATON_GITHUB_CLIENT_SECRET", "GitHub client secret"],
  ["web-url", "CRATON_WEB_URL", "web address"],
];
for (const [flag, key] of pairs) {
  const v = opt(flag);
  if (v) set[key] = v.trim();
}
function main() {
if (!Object.keys(set).length) {
  console.log("Nothing to set. Pass --google-id and --google-secret (and/or --github-id and --github-secret).");
  process.exitCode = 2;
  return;
}
for (const [a, b, label] of [["CRATON_GOOGLE_CLIENT_ID", "CRATON_GOOGLE_CLIENT_SECRET", "Google"], ["CRATON_GITHUB_CLIENT_ID", "CRATON_GITHUB_CLIENT_SECRET", "GitHub"]] as const) {
  const merged = { ...readEnv(existing), ...set };
  if (Boolean(merged[a]) !== Boolean(merged[b])) {
    console.error(`${label} needs both a client id and a client secret.`);
    process.exitCode = 2;
    return;
  }
}
fs.writeFileSync(file, upsertEnv(existing, set), { mode: 0o600 });
const merged = { ...readEnv(existing), ...set };
const web = (merged.CRATON_WEB_URL ?? "http://localhost:3100").replace(/\/+$/, "");
console.log(`Saved ${Object.keys(set).join(", ")} to ${file}.`);
if (merged.CRATON_GOOGLE_CLIENT_ID) console.log(`Google: register this redirect URI in the Google console: ${web}/auth/google/callback`);
if (merged.CRATON_GITHUB_CLIENT_ID) console.log(`GitHub: set the authorization callback URL to: ${web}/auth/github/callback`);
console.log("Restart the API to apply it.");
}
main();
